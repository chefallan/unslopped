import fs from 'node:fs';
import { addedLines, changedFiles, commitSubjects, diffLines, numstatSince, parseUnifiedDiff } from './git.ts';
import { planPath } from './state.ts';
import { tokenize } from './search.ts';
import type { Check, Cycle, Finding, GateContext, Practices } from './types.ts';

export const DEFAULT_TEST_PATTERNS = [
  '\\.(test|spec)\\.[cm]?[jt]sx?$',
  '(^|/)(test|tests|__tests__|spec|specs)/',
  '_test\\.(go|py|rs|rb|php|ex|exs)$',
  '(^|/)test_[^/]+\\.py$',
  '(Test|Tests|Spec)\\.(java|kt|cs|swift|scala)$',
  '\\.(test|spec)\\.(rb|php|dart)$',
];

export const DEFAULT_COMMIT_PATTERN = '^(feat|fix|chore|docs|refactor|test|build|ci|perf|style|revert)(\\([^)]+\\))?!?: .+';

export const DEFAULT_PLAN_SECTIONS = ['Goal', 'Approach', 'Files to touch'];

export const DEFAULT_GUARDED_PATHS = ['**/auth/**', '**/security/**', '**/permissions/**', '**/migrations/**', '**/payment/**', '**/payments/**', '**/billing/**', '**/ledger/**'];

export function practiceDefaults(): Practices {
  return {
    planSections: [...DEFAULT_PLAN_SECTIONS],
    testEvidence: true,
    testPatterns: [...DEFAULT_TEST_PATTERNS],
    coverage: null,
    securityScan: null,
    changelog: true,
    tdd: true,
    reviewArtifact: false,
    reviewCommand: null,
    worktree: false,
    pullRequest: { auto: false, base: null, draft: false },
    style: styleDefaults(),
    scope: true,
    criteriaQuality: true,
    testDeletion: true,
    guardedPaths: [...DEFAULT_GUARDED_PATHS],
    exclusivePaths: [],
    declarations: [],
    handoffNote: false,
    criteriaChecked: true,
    commitPattern: DEFAULT_COMMIT_PATTERN,
    commitScopes: null,
    protectedBranches: ['main', 'master'],
    maxDiffLines: 400,
    secretScan: true,
    exploitScan: true,
    audit: null,
    rollback: true,
    reviewApproval: false,
    monitorNotes: true,
  };
}

export function mergePractices(raw: Partial<Practices> | undefined): Practices {
  const d = practiceDefaults();
  const style = raw && 'style' in raw ? (raw.style ? { ...styleDefaults(), ...raw.style } : null) : d.style;
  return { ...d, ...(raw ?? {}), pullRequest: { ...d.pullRequest, ...(raw?.pullRequest ?? {}) }, style };
}

const SOURCE_EXTS = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'py', 'go', 'rs', 'java', 'kt', 'rb', 'php', 'cs', 'c', 'cc', 'cpp', 'h', 'hpp', 'swift', 'scala', 'vue', 'svelte', 'dart', 'ex', 'exs', 'sql']);

function ext(file: string): string {
  const i = file.lastIndexOf('.');
  return i === -1 ? '' : file.slice(i + 1).toLowerCase();
}

export function isTestFile(file: string, patterns: string[]): boolean {
  const f = file.replace(/\\/g, '/');
  return patterns.some((p) => new RegExp(p).test(f));
}

export function isSourceFile(file: string, patterns: string[]): boolean {
  return SOURCE_EXTS.has(ext(file)) && !isTestFile(file, patterns);
}

function check(name: string, ok: boolean, detail: string): Check {
  return { name, ok, detail };
}

export function testEvidenceCheck(ctx: GateContext): Check | null {
  const p = ctx.config.practices;
  if (!p.testEvidence) return null;
  const files = changedFiles(ctx.root, ctx.cycle.startCommit);
  const source = files.filter((f) => isSourceFile(f, p.testPatterns));
  const tests = files.filter((f) => isTestFile(f, p.testPatterns));
  if (!source.length) return check('test evidence', true, 'no source files changed, nothing to prove');
  if (tests.length) return check('test evidence', true, `${tests.length} test file(s) changed alongside ${source.length} source file(s)`);
  const shown = source.slice(0, 5).join(', ') + (source.length > 5 ? `, +${source.length - 5} more` : '');
  return check('test evidence', false, `source changed (${shown}) but no test file changed. add or update a test. patterns: practices.testPatterns`);
}

export function diffSizeCheck(ctx: GateContext): Check | null {
  const max = ctx.config.practices.maxDiffLines;
  if (!max || max <= 0) return null;
  const n = diffLines(ctx.root, ctx.cycle.startCommit);
  if (n <= max) return check('diff size', true, `${n} changed line(s), limit ${max}`);
  return check('diff size', false, `${n} changed line(s) exceeds the limit of ${max}. split the work into another cycle or raise practices.maxDiffLines`);
}

interface SecretPattern {
  name: string;
  re: RegExp;
  redact?: boolean;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/, redact: true },
  { name: 'AWS secret key assignment', re: /\baws[_-]?secret[_-]?access[_-]?key\b\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}\b/i },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, redact: true },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/, redact: true },
  { name: 'GitLab token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/, redact: true },
  { name: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/, redact: true },
  { name: 'PyPI token', re: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{20,}\b/, redact: true },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, redact: true },
  { name: 'Slack webhook', re: /hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]{20,}/, redact: true },
  { name: 'Stripe live key', re: /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/, redact: true },
  { name: 'SendGrid key', re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/, redact: true },
  { name: 'Twilio key', re: /\bSK[0-9a-fA-F]{32}\b/, redact: true },
  { name: 'Telegram bot token', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/, redact: true },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, redact: true },
  { name: 'GCP service account', re: /"private_key_id"\s*:\s*"[0-9a-f]{40}"/ },
  { name: 'Azure storage key', re: /AccountKey=[A-Za-z0-9+/=]{60,}/, redact: true },
  { name: 'OpenAI key', re: /\bsk-[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}\b/, redact: true },
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{30,}\b/, redact: true },
  { name: 'Linear key', re: /\blin_api_[A-Za-z0-9]{30,}\b/, redact: true },
  { name: 'private key', re: new RegExp('-----BEGIN ' + '[A-Z ]*PRIVATE KEY-----') },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, redact: true },
  { name: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{30,}=*/, redact: true },
  { name: 'connection string with password', re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|ftp|sftp):\/\/[^\s:@/]+:([^\s@/]{4,})@/i, redact: true },
  { name: 'credential assignment', re: /\b(api[_-]?key|secret|token|passw(or)?d)\b\s*[:=]\s*['"][A-Za-z0-9_\-/+=]{16,}['"]/i },
];

const SCAN_SKIP = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|.*\.min\.js|.*\.map|.*\.svg|.*\.lock)$|^\.unslopped\//;
const PLACEHOLDER = /(example|placeholder|your[_-]?|xxx+|changeme|dummy|redacted|<[^>]+>|\$\{[^}]+\}|process\.env|os\.environ|getenv)/i;
const PLACEHOLDER_PASSWORD = /^(pass(word)?|secret|changeme|xxx+|\*+|\$\{|<|%)/i;
const ENV_FILE = /(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/;
const ENV_FILE_OK = /\.env\.(example|sample|template|dist|test|defaults?)$/i;
const SECRET_NAME = /\b[A-Za-z_][A-Za-z0-9_]*(?:key|secret|token|passw(?:or)?d|credential|auth)[A-Za-z0-9_]*\s*[:=]\s*['"`]([^'"`\s]{20,})['"`]/i;

export function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let e = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}

export interface SecretHit {
  file: string;
  line: number;
  name: string;
}

function lineSecret(text: string): string | null {
  for (const p of SECRET_PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;
    if (p.name === 'private key') return p.name;
    if (PLACEHOLDER.test(text)) continue;
    if (p.name === 'connection string with password' && PLACEHOLDER_PASSWORD.test(m[1] ?? '')) continue;
    return p.name;
  }
  const assigned = text.match(SECRET_NAME);
  if (assigned && !PLACEHOLDER.test(text) && !/^https?:\/\//i.test(assigned[1]) && entropy(assigned[1]) > 3.8) return 'high-entropy value assigned to a secret-looking name';
  return null;
}

export function scanLines(lines: Array<{ file: string; line: number; text: string }>): SecretHit[] {
  const hits: SecretHit[] = [];
  const envFiles = new Set<string>();
  for (const added of lines) {
    if (SCAN_SKIP.test(added.file) || ENV_FILE_OK.test(added.file)) continue;
    if (ENV_FILE.test(added.file)) {
      if (!envFiles.has(added.file)) {
        envFiles.add(added.file);
        hits.push({ file: added.file, line: 1, name: 'environment file committed' });
      }
      continue;
    }
    const name = lineSecret(added.text);
    if (name) hits.push({ file: added.file, line: added.line, name });
  }
  return hits;
}

export function scanSecrets(root: string, since: string | null): SecretHit[] {
  return scanLines(addedLines(root, since));
}

export function scanDiffText(diff: string): SecretHit[] {
  return scanLines(parseUnifiedDiff(diff));
}

export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const p of SECRET_PATTERNS) {
    if (!p.redact) continue;
    const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g');
    out = out.replace(re, (match: string, password?: string) => {
      count++;
      if (p.name === 'connection string with password' && password) return match.replace(password, '[redacted]');
      if (p.name === 'bearer token') return 'Bearer [redacted]';
      return `[redacted ${p.name}]`;
    });
  }
  return { text: out, count };
}

export function configSecretProblem(config: unknown): string | null {
  const text = JSON.stringify(config, null, 1);
  for (const [i, line] of text.split('\n').entries()) {
    const name = lineSecret(line);
    if (name) return `unslopped.config.json line ${i + 1} contains what looks like a ${name}. credentials belong in environment variables, never in the config`;
  }
  return null;
}

export function secretScanCheck(ctx: GateContext): Check | null {
  if (!ctx.config.practices.secretScan) return null;
  const hits = scanSecrets(ctx.root, ctx.cycle.startCommit);
  if (!hits.length) return check('secret scan', true, 'no credentials in the diff');
  const shown = hits.slice(0, 5).map((h) => `${h.file}:${h.line} looks like a ${h.name}`).join('\n');
  return check('secret scan', false, `${hits.length} possible credential(s) in the diff. move them to env vars and rotate them:\n${shown}`);
}

export interface StyleRules {
  forbidden: string[];
  fillerWords: string[];
  maxCommentRatio: number;
  noIssueRefs: boolean;
  singleOutcomeTests: boolean;
}

export const DEFAULT_FILLER_WORDS = ['basically', 'simply', 'just', 'very', 'really', 'actually', 'obviously', 'of course', 'clearly', 'easily', 'in order to', 'note that', 'it is worth noting', 'needless to say', 'as you can see'];

export function styleDefaults(): StyleRules {
  return { forbidden: ['—', '–'], fillerWords: [...DEFAULT_FILLER_WORDS], maxCommentRatio: 0.25, noIssueRefs: true, singleOutcomeTests: true };
}

const DEBT_MARK = /\b(TODO|FIXME|HACK|XXX)\b/;
const ISSUE_REF = /(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,9}-\d+)(?![A-Za-z0-9])/;
const ISSUE_REF_STOP = new Set(['UTF', 'SHA', 'MD', 'RFC', 'ISO', 'HTTP', 'HTTPS', 'TLS', 'SSL', 'AES', 'RSA', 'ES', 'CVE', 'GPT', 'IEEE', 'IPV', 'OAUTH']);
const MULTI_OUTCOME = /\b(?:it|test)\s*\(\s*['"`][^'"`]*\s(?:and|then)\s[^'"`]*['"`]/;

const CHAR_NAMES: Record<string, string> = { '—': 'em dash', '–': 'en dash' };
const PROSE_EXT = new Set(['md', 'mdx', 'txt', 'rst', 'adoc']);

function commentPrefix(file: string): RegExp | null {
  const e = ext(file);
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'java', 'kt', 'cs', 'c', 'cc', 'cpp', 'h', 'hpp', 'go', 'rs', 'swift', 'scala', 'dart', 'php', 'vue', 'svelte'].includes(e)) return /^\s*(\/\/|\/\*|\*)/;
  if (['py', 'rb', 'sh', 'bash', 'zsh', 'pl', 'ex', 'exs', 'yaml', 'yml', 'toml'].includes(e)) return /^\s*#/;
  if (['sql', 'lua'].includes(e)) return /^\s*--/;
  if (['html', 'xml'].includes(e)) return /^\s*<!--/;
  return null;
}

export interface StyleHit {
  file: string;
  line: number;
  problem: string;
}

const STYLE_SKIP = /(^|\/)unslopped\.config\.json$/;

export function scanStyle(lines: Array<{ file: string; line: number; text: string }>, rules: StyleRules): StyleHit[] {
  const hits: StyleHit[] = [];
  const filler = rules.fillerWords.length ? new RegExp(`\\b(${rules.fillerWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i') : null;
  const perFile = new Map<string, { total: number; comments: number }>();
  for (const l of lines) {
    if (SCAN_SKIP.test(l.file) || STYLE_SKIP.test(l.file)) continue;
    for (const ch of rules.forbidden) {
      if (l.text.includes(ch)) hits.push({ file: l.file, line: l.line, problem: `${CHAR_NAMES[ch] ?? JSON.stringify(ch)} in "${l.text.trim().slice(0, 60)}"` });
    }
    const prefix = commentPrefix(l.file);
    const prose = PROSE_EXT.has(ext(l.file));
    const isComment = prefix ? prefix.test(l.text) : false;
    if (filler && (prose || isComment)) {
      const m = l.text.match(filler);
      if (m) hits.push({ file: l.file, line: l.line, problem: `filler word "${m[1]}" in "${l.text.trim().slice(0, 60)}"` });
    }
    if (rules.noIssueRefs && isComment && !DEBT_MARK.test(l.text)) {
      const ref = l.text.match(ISSUE_REF);
      if (ref && !ISSUE_REF_STOP.has(ref[1].split('-')[0])) hits.push({ file: l.file, line: l.line, problem: `issue reference ${ref[1]} in a comment. trackers get archived; state the reason itself, or cite a durable doc. only a TODO may carry a ticket id, as a trailing detail` });
    }
    if (rules.singleOutcomeTests && isTestFile(l.file, DEFAULT_TEST_PATTERNS) && MULTI_OUTCOME.test(l.text)) {
      hits.push({ file: l.file, line: l.line, problem: `test name bundles several outcomes ("${l.text.trim().slice(0, 60)}"). one test proves one outcome; when it fails the name should say what broke` });
    }
    if (prefix && l.text.trim()) {
      const f = perFile.get(l.file) ?? { total: 0, comments: 0 };
      f.total++;
      if (isComment) f.comments++;
      perFile.set(l.file, f);
    }
  }
  for (const [file, f] of perFile) {
    if (f.total >= 10 && f.comments / f.total > rules.maxCommentRatio) {
      hits.push({ file, line: 0, problem: `${Math.round((100 * f.comments) / f.total)}% of added lines are comments (limit ${Math.round(rules.maxCommentRatio * 100)}%). keep the ones that say what the code cannot` });
    }
  }
  return hits;
}

export function styleCheck(ctx: GateContext): Check | null {
  const rules = ctx.config.practices.style;
  if (!rules) return null;
  const hits = scanStyle(addedLines(ctx.root, ctx.cycle.startCommit), rules);
  if (!hits.length) return check('style', true, 'no dashes, filler or comment noise in the diff');
  const shown = hits.slice(0, 8).map((h) => `${h.file}${h.line ? `:${h.line}` : ''} ${h.problem}`).join('\n');
  return check('style', false, `${hits.length} style problem(s) in the diff. write precisely and directly:\n${shown}${hits.length > 8 ? `\n+${hits.length - 8} more` : ''}`);
}

export interface Criterion {
  text: string;
  checked: boolean;
}

export function criteriaItems(markdown: string): Criterion[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+acceptance criteria/i.test(l.trim()));
  if (start === -1) return [];
  const items: Criterion[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const m = line.match(/^\s*[-*]\s+(.*)$/);
    if (!m) continue;
    const box = m[1].match(/^\[([ xX])\]\s*(.*)$/);
    const text = (box ? box[2] : m[1]).trim();
    if (text) items.push({ text, checked: Boolean(box && box[1] !== ' ') });
  }
  return items;
}

export function criteriaCheckedCheck(ctx: GateContext): Check | null {
  if (!ctx.config.practices.criteriaChecked) return null;
  let plan = '';
  try {
    plan = fs.readFileSync(planPath(ctx.root, ctx.cycle.id), 'utf8');
  } catch {
    return check('criteria verified', false, 'plan file is missing');
  }
  const items = criteriaItems(plan);
  const open = items.filter((c) => !c.checked);
  if (!open.length) return check('criteria verified', true, `${items.length} criterion(s) ticked`);
  return check('criteria verified', false, `${open.length} acceptance criterion(s) not ticked [x] in the plan. verify each one, then tick it:\n${open.map((c) => `- ${c.text}`).join('\n')}`);
}

export function commitFormatCheck(ctx: GateContext): Check | null {
  const pattern = ctx.config.practices.commitPattern;
  if (!pattern) return null;
  const re = new RegExp(pattern);
  const scopes = ctx.config.practices.commitScopes;
  const subjects = commitSubjects(ctx.cycle.startCommit, ctx.root).filter((s) => !/^Merge /.test(s));
  const problems: string[] = [];
  for (const s of subjects) {
    if (!re.test(s)) {
      problems.push(`- ${s}  (does not match ${pattern})`);
      continue;
    }
    if (s.length > 72) problems.push(`- ${s.slice(0, 60)}...  (subject is ${s.length} chars, keep it under 72)`);
    if (scopes !== null) {
      const scope = s.match(/^\w+\(([^)]+)\)/)?.[1];
      if (!scope) problems.push(`- ${s}  (a scope is required: type(scope): subject)`);
      else if (scopes.length && !scopes.includes(scope)) problems.push(`- ${s}  (scope "${scope}" is not one of: ${scopes.join(', ')})`);
    }
  }
  if (!problems.length) return check('commit format', true, `${subjects.length} commit(s) match ${pattern}${scopes !== null ? ', scoped' : ''}, subjects under 72 chars`);
  return check('commit format', false, `${problems.length} commit message problem(s):\n${problems.join('\n')}\namend or squash them before release`);
}

export function reviewApprovalCheck(ctx: GateContext): Check | null {
  const guarded = ctx.config.practices.reviewApproval ? [] : touchedGuarded(ctx);
  if (!ctx.config.practices.reviewApproval && !guarded.length) return null;
  const approved = ctx.cycle.approvals?.review;
  if (approved) return check('review approval', true, `approved at ${approved.at}`);
  const why = guarded.length ? `guarded paths were touched (${guarded.slice(0, 3).join(', ')}), so a human reader is required no matter how small the diff. ` : '';
  return check('review approval', false, `${why}a human reviewer must run: unslopped approve review`);
}

export function rollbackCheck(ctx: GateContext): Check | null {
  if (!ctx.config.practices.rollback || !ctx.config.commands.deploy) return null;
  const cmd = ctx.config.commands.rollback;
  return check('rollback ready', Boolean(cmd), cmd ? `rollback: ${cmd}` : 'commands.rollback is not set. define how to undo this deploy before running it, or set practices.rollback to false');
}

export function monitorNotesCheck(ctx: GateContext, monitorSection: string): Check | null {
  if (!ctx.config.practices.monitorNotes) return null;
  const failures = ctx.cycle.history.filter((h) => !h.pass).length;
  if (!failures) return check('monitor notes', true, 'no gate failures this cycle, notes optional');
  if (monitorSection.trim()) return check('monitor notes', true, 'notes present');
  return check('monitor notes', false, `${failures} gate run(s) failed this cycle. write what happened and what to do next time under "## Monitor" in the plan`);
}

export function globToRegExp(glob: string): RegExp {
  let out = '^';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += glob[i + 2] === '/' ? 2 : 1;
      } else out += '[^/]*';
    } else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.*+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(out + '$');
}

export function matchesAny(file: string, globs: string[]): boolean {
  const f = file.replace(/\\/g, '/');
  return globs.some((g) => globToRegExp(g).test(f));
}

export function touchedGuarded(ctx: GateContext): string[] {
  const globs = ctx.config.practices.guardedPaths;
  if (!globs.length) return [];
  return changedFiles(ctx.root, ctx.cycle.startCommit).filter((f) => matchesAny(f, globs));
}

const VAGUE = /\b(works?|working|properly|appropriately|correctly|as expected|handled?|handles?|is good|is fine|behaves well|functions)\b/i;
const NEGATIVE = /\b(fail(s|ed|ure)?|refus\w+|reject\w+|denie[ds]|deny|denied|forbidden|block(s|ed)?|cannot|can't|does not|doesn't|is not|isn't|must not|error|invalid|unauthor\w+|4\d\d)\b/i;
const EMPTY_SECTION = /^\s*(n\/?a|none|tbd|todo|-)\s*$/i;

export function isVagueCriterion(text: string): boolean {
  return VAGUE.test(text) && !NEGATIVE.test(text);
}

export function criteriaVagueCheck(ctx: GateContext, plan: string): Check | null {
  if (!ctx.config.practices.criteriaQuality) return null;
  const vague = criteriaItems(plan).filter((c) => isVagueCriterion(c.text));
  if (!vague.length) return check('criteria quality', true, 'every criterion states an observable outcome');
  return check('criteria quality', false, `${vague.length} criterion(s) are descriptions, not verifiable outcomes. state what can be observed (status code, value, visible effect):\n${vague.map((c) => `- ${c.text}`).join('\n')}`);
}

export function negativeCriterionCheck(ctx: GateContext, plan: string): Check | null {
  if (!ctx.config.practices.criteriaQuality) return null;
  const guarded = touchedGuarded(ctx);
  if (!guarded.length) return null;
  const hasNegative = criteriaItems(plan).some((c) => NEGATIVE.test(c.text));
  if (hasNegative) return check('negative case', true, `guarded paths touched (${guarded[0]}${guarded.length > 1 ? `, +${guarded.length - 1}` : ''}) and a rejection criterion exists`);
  return check('negative case', false, `this change touches guarded paths (${guarded.slice(0, 3).join(', ')}). add an acceptance criterion for what must be refused or fail, and a test for it`);
}

const NOT_SCOPED = /(^|\/)(\.gitignore|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|CHANGELOG[^/]*|.*\.lock)$|^\.unslopped\/|^\.github\//;

export function scopeCheck(ctx: GateContext, plan: string): Check | null {
  if (!ctx.config.practices.scope) return null;
  const declared = planSection(plan, 'Files to touch')
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*]\s*/, '').replace(/`/g, '').trim())
    .filter((l) => l && !EMPTY_SECTION.test(l));
  if (!declared.length) return null;
  const covers = (file: string) =>
    declared.some((d) => {
      const entry = d.replace(/\\/g, '/').replace(/\/+$/, '');
      const f = file.replace(/\\/g, '/');
      if (entry.includes('*')) return matchesAny(f, [entry]);
      return f === entry || f.startsWith(entry + '/') || f.endsWith('/' + entry) || f.split('/').pop() === entry;
    });
  const undeclared = changedFiles(ctx.root, ctx.cycle.startCommit).filter((f) => !NOT_SCOPED.test(f) && !covers(f));
  if (!undeclared.length) return check('scope', true, 'every changed file is declared in the plan');
  return check('scope', false, `${undeclared.length} changed file(s) are not in the plan's "## Files to touch":\n${undeclared.slice(0, 8).map((f) => `- ${f}`).join('\n')}\nadd them there with a reason, or revert them. widening scope silently is the failure mode this prevents`);
}

export function exclusiveCheck(ctx: GateContext): Check | null {
  const globs = ctx.config.practices.exclusivePaths;
  if (!globs.length) return null;
  const changed = changedFiles(ctx.root, ctx.cycle.startCommit).filter((f) => !NOT_SCOPED.test(f));
  const exclusive = changed.filter((f) => matchesAny(f, globs));
  if (!exclusive.length) return null;
  const rest = changed.filter((f) => !matchesAny(f, globs) && !isTestFile(f, ctx.config.practices.testPatterns));
  if (!rest.length) return check('ships alone', true, 'this change touches only exclusive paths and their tests');
  const shown = exclusive.find((f) => !isTestFile(f, ctx.config.practices.testPatterns)) ?? exclusive[0];
  return check('ships alone', false, `${shown} is an exclusive path (a shared boundary): a change to it ships in its own cycle. also changed: ${rest.slice(0, 5).join(', ')}. split the work`);
}

export function testDeletionCheck(ctx: GateContext, plan: string): Check | null {
  if (!ctx.config.practices.testDeletion) return null;
  const stats = numstatSince(ctx.root, ctx.cycle.startCommit).filter((s) => isTestFile(s.file, ctx.config.practices.testPatterns));
  const gone = stats.filter((s) => !fs.existsSync(`${ctx.root}/${s.file}`));
  const shrunk = stats.filter((s) => fs.existsSync(`${ctx.root}/${s.file}`) && s.deleted - s.added > 10);
  if (!gone.length && !shrunk.length) return check('tests kept', true, 'no test file deleted or heavily shrunk');
  const justified = planSection(plan, 'Removed tests').trim();
  if (justified && !EMPTY_SECTION.test(justified)) return check('tests kept', true, `test removals are justified under "## Removed tests"`);
  const shown = [...gone.map((s) => `- ${s.file} deleted`), ...shrunk.map((s) => `- ${s.file} lost ${s.deleted - s.added} line(s)`)].slice(0, 6).join('\n');
  return check('tests kept', false, `tests were removed:\n${shown}\nnever delete tests to get past a gate. if the removal is legitimate, explain it under "## Removed tests" in the plan`);
}

export function declarationsCheck(ctx: GateContext, plan: string): Check | null {
  const decls = ctx.config.practices.declarations;
  if (!decls.length) return null;
  const changed = changedFiles(ctx.root, ctx.cycle.startCommit);
  const due = decls.filter((d) => changed.some((f) => matchesAny(f, [d.when])));
  if (!due.length) return null;
  const missing = due.filter((d) => !new RegExp(`^\\s*(?:[-*]\\s*)?${d.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*\\S`, 'im').test(plan));
  if (!missing.length) return check('declarations', true, due.map((d) => d.name).join(', ') + ' declared in the plan');
  return check('declarations', false, `this change requires explicit statements in the plan, even when the answer is "none":\n${missing.map((d) => `- add a line "${d.name}: ..."`).join('\n')}`);
}

export function openQuestionsCheck(ctx: GateContext, plan: string): Check | null {
  if (!ctx.config.practices.criteriaQuality) return null;
  const section = planSection(plan, 'Open questions');
  const open = section.split(/\r?\n/).map((l) => l.replace(/^[-*]\s*(\[[ xX]\]\s*)?/, '').trim()).filter((l) => l && !EMPTY_SECTION.test(l) && !/^resolved\b/i.test(l));
  if (!open.length) return check('no open questions', true, 'nothing unresolved in the plan');
  return check('no open questions', false, `${open.length} open question(s) in the plan. work past release carries none: get each answered by the human, record the answer, then remove or mark it resolved:\n${open.slice(0, 5).map((q) => `- ${q}`).join('\n')}`);
}

export function handoffCheck(ctx: GateContext, plan: string): Check | null {
  if (!ctx.config.practices.handoffNote) return null;
  const note = planSection(plan, 'Handoff');
  const lines = note.split(/\r?\n/).filter((l) => l.trim() && !EMPTY_SECTION.test(l));
  if (lines.length >= 2) return check('handoff note', true, `${lines.length} line(s) under "## Handoff"`);
  return check('handoff note', false, 'write the handoff under "## Handoff" in the plan: what to verify, how to reach it, the concrete data needed, the rejections to try with expected results, and any gotchas. it is posted to the linked issue when the cycle completes');
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

export function planSectionsCheck(ctx: GateContext, plan: string): Check | null {
  const wanted = ctx.config.practices.planSections;
  if (!wanted.length) return null;
  const empty = wanted.filter((h) => !planSection(plan, h).replace(/^-\s*(\[[ xX]\])?\s*$/gm, '').trim());
  if (!empty.length) return check('plan sections', true, `${wanted.join(', ')} filled in`);
  return check('plan sections', false, `fill in ${empty.map((h) => `"## ${h}"`).join(', ')} before leaving plan. one line each is enough; the point is to decide before coding`);
}

export function parseCoverage(output: string): number | null {
  const lines = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/);
  const num = (s: string) => Number(s);
  const pct = (l: string) => [...l.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => num(m[1])).find((n) => n <= 100);
  const summary = lines.find((l) => /^\s*\|?\s*(all files|total)\b/i.test(l));
  if (summary) {
    const withPct = pct(summary);
    if (withPct !== undefined) return withPct;
    const nums = [...summary.matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map((m) => num(m[1])).filter((n) => n <= 100);
    if (nums.length) return nums[0];
  }
  const labelled = lines.find((l) => /\bcoverage\b/i.test(l) && /\d+(?:\.\d+)?\s*%/.test(l));
  if (labelled) return pct(labelled) ?? null;
  for (const l of [...lines].reverse()) {
    const p = pct(l);
    if (p !== undefined) return p;
  }
  return null;
}

export function coverageCheck(ctx: GateContext, run: (cmd: string, cwd: string) => { code: number; output: string; ms: number }): Check | null {
  const cov = ctx.config.practices.coverage;
  if (!cov?.command) return null;
  const r = run(cov.command, ctx.root);
  if (r.code !== 0) return check('coverage', false, `${cov.command} (exit ${r.code}, ${r.ms}ms)\n${r.output.trim().split(/\r?\n/).slice(-10).join('\n')}`);
  const pct = parseCoverage(r.output);
  if (pct === null) return check('coverage', false, `${cov.command} ran but no coverage percentage was found in its output. print a summary line like "All files | 85.7" or "TOTAL 92%"`);
  if (pct < cov.min) return check('coverage', false, `coverage ${pct}% is below the minimum of ${cov.min}%. add tests for the code you changed`);
  return check('coverage', true, `coverage ${pct}% (minimum ${cov.min}%)`);
}

export function changelogCheck(ctx: GateContext): Check | null {
  if (!ctx.config.practices.changelog) return null;
  const names = ['CHANGELOG.md', 'CHANGELOG', 'CHANGES.md', 'HISTORY.md'];
  const present = names.find((n) => fs.existsSync(`${ctx.root}/${n}`));
  if (!present) return null;
  const changed = changedFiles(ctx.root, ctx.cycle.startCommit).some((f) => f.toLowerCase() === present.toLowerCase());
  if (changed) return check('changelog', true, `${present} updated`);
  return check('changelog', false, `${present} exists but was not updated this cycle. add an entry for this change, or set practices.changelog to false`);
}

export function changedTestFiles(root: string, since: string | null, patterns: string[]): string[] {
  return changedFiles(root, since).filter((f) => isTestFile(f, patterns));
}

export function redCheck(ctx: GateContext): Check | null {
  const p = ctx.config.practices;
  if (!p.tdd) return null;
  const files = changedFiles(ctx.root, ctx.cycle.startCommit);
  const source = files.filter((f) => isSourceFile(f, p.testPatterns));
  const tests = files.filter((f) => isTestFile(f, p.testPatterns));
  if (!source.length || !tests.length) return check('red before green', true, 'no source and test pair changed, nothing to prove');
  const runs = (ctx.cycle.red ?? []).filter((r) => r.code !== 0 && r.testFiles.some((f) => tests.includes(f)));
  if (runs.length) return check('red before green', true, `${runs.length} failing run(s) recorded before green, latest at ${runs[runs.length - 1].at}`);
  return check('red before green', false, 'no failing test run recorded for the changed test files. write the test first, run `unslopped red` and watch it fail, then implement. set practices.tdd to false to drop this');
}

export interface FindingCounts {
  critical: number;
  major: number;
  minor: number;
}

const SEVERITY = 'critical|blocker|major|minor|nit|suggestion';
const FINDING = new RegExp(`^\\s*(?:[-*]\\s*|\\d+\\.\\s*)?(?:\\[\\s*(${SEVERITY})\\s*\\]|(${SEVERITY})\\s*[:\\-)])`, 'i');

const LOCATION = /(?:^|[\s(`])((?:[A-Za-z0-9_.-]+[\\/])*[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,10}):(\d+)/;

export function parseFindings(text: string): Finding[] {
  const out: Finding[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(FINDING);
    if (!m) continue;
    const sev = (m[1] ?? m[2]).toLowerCase();
    const severity: Finding['severity'] = sev === 'critical' || sev === 'blocker' ? 'critical' : sev === 'major' ? 'major' : 'minor';
    const body = line.slice(m[0].length).replace(/^\s*[:\-)]\s*/, '').trim();
    const loc = body.match(LOCATION);
    const finding: Finding = { severity, text: body };
    if (loc) {
      finding.file = loc[1].replace(/\\/g, '/').replace(/^(\.\/|[ab]\/)/, '');
      finding.line = Number(loc[2]);
    }
    out.push(finding);
  }
  return out;
}

export function countFindings(text: string): FindingCounts {
  const counts: FindingCounts = { critical: 0, major: 0, minor: 0 };
  for (const f of parseFindings(text)) counts[f.severity]++;
  return counts;
}

export function reviewArtifactCheck(ctx: GateContext, lastCommitMs: number | null): Check | null {
  if (!ctx.config.practices.reviewArtifact) return null;
  const r = ctx.cycle.review;
  if (!r) return check('review artifact', false, 'no review recorded. run `unslopped review` (practices.reviewCommand, a second agent, or --file=<review.md>) before release');
  if (r.critical > 0) return check('review artifact', false, `${r.critical} critical finding(s) in ${r.file}. fix them, commit, and run \`unslopped review\` again`);
  if (lastCommitMs !== null && Date.parse(r.at) < lastCommitMs) return check('review artifact', false, `review at ${r.at} is older than the latest commit. run \`unslopped review\` again so the reviewed code is the released code`);
  return check('review artifact', true, `${r.file}: 0 critical, ${r.major} major, ${r.minor} minor, reviewed after the last commit`);
}

export function protectedBranchProblem(practices: Practices, branch: string | null, suggestion: string): string | null {
  if (!branch || !practices.protectedBranches.includes(branch)) return null;
  return `branch "${branch}" is protected. create a working branch first: git checkout -b ${suggestion}\nor run the cycle in its own checkout: unslopped start --worktree "<goal>"\nor set practices.protectedBranches to [] in unslopped.config.json`;
}

export function branchSuggestion(goal: string, issueKey: string | null | undefined): string {
  const key = issueKey ? issueKey.replace(/^#/, '').replace(/[^A-Za-z0-9-]+/g, '-').toLowerCase() : '';
  const slug = tokenize(goal)
    .map((w) => w.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter((w) => w && w !== key)
    .slice(0, 5)
    .join('-');
  return [key, slug].filter(Boolean).join('-') || 'work';
}

export function cycleFailures(cycle: Cycle): number {
  return cycle.history.filter((h) => !h.pass).length;
}
