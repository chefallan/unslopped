import fs from 'node:fs';
import path from 'node:path';
import { runCommand, tail } from './run.ts';
import { isRepo, porcelain, commitsSince, lastCommitMs } from './git.ts';
import { planPath, stateDir, STATE_DIR } from './state.ts';
import { briefLines } from './brief.ts';
import { digest, account } from './tokens.ts';
import { authorshipCheck, changelogCheck, commitFormatCheck, coverageCheck, criteriaCheckedCheck, criteriaItems, criteriaVagueCheck, declarationsCheck, diffSizeCheck, exclusiveCheck, handoffCheck, monitorNotesCheck, negativeCriterionCheck, openQuestionsCheck, planSectionsCheck, quizCheck, redCheck, redactSecrets, reviewApprovalCheck, reviewArtifactCheck, rollbackCheck, scopeCheck, secretScanCheck, styleCheck, testDeletionCheck, testEvidenceCheck } from './practices.ts';
import type { Check, Config, GateContext, GateResult, Phase } from './types.ts';

function check(name: string, ok: boolean, detail = ''): Check {
  return { name, ok, detail };
}

function present(checks: Array<Check | null>): Check[] {
  return checks.filter((c): c is Check => c !== null);
}

function writeLog(ctx: GateContext, name: string, output: string): string {
  const dir = path.join(stateDir(ctx.root), 'logs', ctx.cycle?.id ?? 'no-cycle');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ctx.phase ?? 'gate'}-${name}-${Date.now()}.log`);
  fs.writeFileSync(file, output);
  return path.relative(ctx.root, file).replace(/\\/g, '/');
}

function shownOutput(ctx: GateContext, name: string, output: string): string {
  const t = ctx.config.tokens;
  if (t.mode === 'full') return tail(output);
  const d = digest(output, { lines: t.outputLines ?? 25 });
  if (d.omitted <= 0) return d.text;
  return `${d.text}\n(${d.omitted} line(s) omitted) full log: ${writeLog(ctx, name, output)}`;
}

function commandCheck(name: string, cmd: string | null, ctx: GateContext, { required = false } = {}): Check {
  if (!cmd) {
    return required
      ? check(name, false, `commands.${name} is not set in unslopped.config.json`)
      : check(name, true, `no ${name} command configured, skipped`);
  }
  const r = runCommand(cmd, ctx.root);
  if (r.code === 0) return check(name, true, `${cmd} (exit 0, ${r.ms}ms)`);
  const safe = redactSecrets(r.output);
  const shown = shownOutput(ctx, name, safe.text);
  account(ctx.cycle, 'gate', r.output.length, shown.length);
  const note = safe.count ? `\n(${safe.count} credential-looking value(s) redacted from this output)` : '';
  return check(name, false, `${cmd} (exit ${r.code}, ${r.ms}ms)\n${shown}${note}`);
}

export function acceptanceCriteria(markdown: string): string[] {
  return criteriaItems(markdown).map((c) => c.text);
}

export function planSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return '';
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^##\s/.test(l)) break;
    out.push(l);
  }
  return out.join('\n').trim();
}

function readPlan(ctx: GateContext): string {
  try {
    return fs.readFileSync(planPath(ctx.root, ctx.cycle.id), 'utf8');
  } catch {
    return '';
  }
}

function planGate(ctx: GateContext): Check[] {
  const file = planPath(ctx.root, ctx.cycle.id);
  if (!fs.existsSync(file)) return [check('plan file', false, `${file} does not exist`)];
  const plan = fs.readFileSync(file, 'utf8');
  const items = acceptanceCriteria(plan);
  return present([
    check('plan file', true, file),
    planSectionsCheck(ctx, plan),
    check('acceptance criteria', items.length > 0, items.length ? `${items.length} item(s)` : 'add at least one item under "## Acceptance criteria"'),
    items.length ? criteriaVagueCheck(ctx, plan) : null,
  ]);
}

function codeGate(ctx: GateContext): Check[] {
  if (!isRepo(ctx.root)) return [check('git', false, 'not a git repository, run git init first')];
  const dirty = porcelain(ctx.root, { exclude: [STATE_DIR] }).length > 0;
  const commits = commitsSince(ctx.cycle.startCommit, ctx.root);
  const changed = dirty || commits > 0;
  const checks: Array<Check | null> = [check('changes', changed, changed ? `${commits} commit(s), working tree ${dirty ? 'dirty' : 'clean'}` : 'no changes since the cycle started')];
  if (changed) {
    const plan = readPlan(ctx);
    checks.push(scopeCheck(ctx, plan), exclusiveCheck(ctx), testEvidenceCheck(ctx), testDeletionCheck(ctx, plan), diffSizeCheck(ctx), secretScanCheck(ctx), styleCheck(ctx));
  }
  checks.push(commandCheck('lint', ctx.config.commands.lint, ctx));
  return present(checks);
}

function buildGate(ctx: GateContext): Check[] {
  const checks: Check[] = [commandCheck('build', ctx.config.commands.build, ctx)];
  if (ctx.config.practices.audit) checks.push(commandCheck('audit', ctx.config.practices.audit, ctx));
  if (ctx.config.practices.securityScan) checks.push(commandCheck('security scan', ctx.config.practices.securityScan, ctx));
  return checks;
}

function testGate(ctx: GateContext): Check[] {
  const test = commandCheck('test', ctx.config.commands.test, ctx, { required: true });
  if (!test.ok) return [test];
  return present([test, redCheck(ctx), coverageCheck(ctx, (cmd, cwd) => runCommand(cmd, cwd))]);
}

function releaseGate(ctx: GateContext): Check[] {
  if (!isRepo(ctx.root)) return [check('git', false, 'not a git repository, run git init first')];
  const status = porcelain(ctx.root);
  const commits = commitsSince(ctx.cycle.startCommit, ctx.root);
  const plan = readPlan(ctx);
  return present([
    check('clean tree', status.length === 0, status.length ? `uncommitted changes:\n${status}` : 'all changes committed'),
    check('commits', commits > 0, commits > 0 ? `${commits} commit(s) since cycle start` : 'no commits since cycle start'),
    criteriaCheckedCheck(ctx),
    negativeCriterionCheck(ctx, plan),
    openQuestionsCheck(ctx, plan),
    declarationsCheck(ctx, plan),
    exclusiveCheck(ctx),
    testDeletionCheck(ctx, plan),
    commits > 0 ? commitFormatCheck(ctx) : null,
    commits > 0 ? authorshipCheck(ctx) : null,
    changelogCheck(ctx),
    secretScanCheck(ctx),
    styleCheck(ctx),
    reviewArtifactCheck(ctx, lastCommitMs(ctx.root)),
    reviewApprovalCheck(ctx),
    commandCheck('release', ctx.config.commands.release, ctx),
  ]);
}

function deployGate(ctx: GateContext): Check[] {
  const checks: Array<Check | null> = [];
  const quiz = quizCheck(ctx, lastCommitMs(ctx.root));
  if (quiz) {
    checks.push(quiz);
    if (!quiz.ok) return present(checks);
  }
  if (ctx.config.deploy.requireApproval) {
    const approved = ctx.cycle.approvals?.deploy;
    checks.push(check('approval', Boolean(approved), approved ? `approved at ${approved.at}` : `a human must run: unslopped approve deploy\n${briefLines(ctx.root, ctx.config, ctx.cycle).join('\n')}`));
    if (!approved) return present(checks);
  }
  const rollback = rollbackCheck(ctx);
  checks.push(rollback);
  if (rollback && !rollback.ok) return present(checks);
  checks.push(commandCheck('deploy', ctx.config.commands.deploy, ctx));
  return present(checks);
}

function operateGate(ctx: GateContext): Check[] {
  const c = commandCheck('healthcheck', ctx.config.commands.healthcheck, ctx);
  if (!c.ok && ctx.config.commands.rollback) c.detail += `\nhealthcheck failed after deploy. a human can undo it with: unslopped rollback (${ctx.config.commands.rollback})`;
  return [c];
}

function monitorGate(ctx: GateContext): Check[] {
  const plan = readPlan(ctx);
  return present([commandCheck('monitor', ctx.config.commands.monitor, ctx), monitorNotesCheck(ctx, planSection(plan, 'Monitor')), handoffCheck(ctx, plan)]);
}

const GATES: Record<Phase, (ctx: GateContext) => Check[]> = {
  plan: planGate,
  code: codeGate,
  build: buildGate,
  test: testGate,
  release: releaseGate,
  deploy: deployGate,
  operate: operateGate,
  monitor: monitorGate,
};

export function describeGate(phase: Phase, config: Config): string {
  const c = config.commands;
  const p = config.practices;
  const cmd = (k: keyof typeof c) => c[k] ?? `(no ${k} command)`;
  switch (phase) {
    case 'plan':
      return `${p.planSections.length ? `${p.planSections.join(', ')} filled in, ` : ''}at least one acceptance criterion${p.criteriaQuality ? ', criteria are observable outcomes' : ''}`;
    case 'code':
      return `changes exist${p.scope ? ', every changed file declared in the plan' : ''}${p.testEvidence ? ', tests changed with source' : ''}${p.testDeletion ? ', no tests removed' : ''}${p.maxDiffLines > 0 ? `, diff under ${p.maxDiffLines} lines` : ''}${p.secretScan ? ', no secrets' : ''}${p.style ? ', style clean' : ''}, lint: ${cmd('lint')}`;
    case 'build':
      return `build: ${cmd('build')}${p.audit ? `, audit: ${p.audit}` : ''}${p.securityScan ? `, security scan: ${p.securityScan}` : ''}`;
    case 'test':
      return `test: ${cmd('test')}${p.tdd ? ', a red run recorded for the changed tests' : ''}${p.coverage ? `, coverage >= ${p.coverage.min}%` : ''}`;
    case 'release':
      return `clean tree, new commits${p.criteriaChecked ? ', criteria ticked' : ''}${p.commitPattern ? ', commit format' : ''}${p.humanAuthorship ? ', authors are humans' : ''}${p.changelog ? ', changelog updated if present' : ''}${p.secretScan ? ', no secrets' : ''}${p.reviewArtifact ? ', review with no critical findings' : ''}${p.reviewApproval ? ', review approval' : ''}, release: ${cmd('release')}`;
    case 'deploy':
      return `${p.quiz?.enabled ? `quiz passed on a diff of ${p.quiz.minLines}+ lines, ` : ''}${config.deploy.requireApproval ? 'human approval, ' : ''}${p.rollback && c.deploy ? 'rollback configured, ' : ''}deploy: ${cmd('deploy')}`;
    case 'operate':
      return `healthcheck: ${cmd('healthcheck')}`;
    case 'monitor':
      return `monitor: ${cmd('monitor')}${p.monitorNotes ? ', notes when the cycle had failures' : ''}${p.handoffNote ? ', handoff note written' : ''}`;
    default:
      return '';
  }
}

export function runGate(phase: Phase, ctx: GateContext): GateResult {
  const gate = GATES[phase];
  if (!gate) throw new Error(`unknown phase: ${phase}`);
  const checks = gate({ ...ctx, phase });
  return { phase, pass: checks.every((c) => c.ok), checks };
}
