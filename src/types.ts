export type Phase = 'plan' | 'code' | 'build' | 'test' | 'release' | 'deploy' | 'operate' | 'monitor';

export type Provider = 'linear' | 'jira' | 'github' | 'webhook';

export type Env = Record<string, string | undefined>;

export interface Writer {
  write(chunk: string): unknown;
}

export interface Commands {
  setup: string | null;
  lint: string | null;
  build: string | null;
  test: string | null;
  release: string | null;
  deploy: string | null;
  rollback: string | null;
  healthcheck: string | null;
  monitor: string | null;
}

export interface TrackerConfig {
  provider: Provider | null;
  comments: boolean;
  transitions: Record<string, string>;
  jira: { baseUrl: string | null };
  github: { repo: string | null };
  webhook: { url: string | null };
}

export interface Practices {
  planSections: string[];
  testEvidence: boolean;
  testPatterns: string[];
  coverage: { command: string; min: number } | null;
  securityScan: string | null;
  changelog: boolean;
  tdd: boolean;
  reviewArtifact: boolean;
  reviewCommand: string | null;
  worktree: boolean;
  pullRequest: { auto: boolean; base: string | null; draft: boolean };
  style: { forbidden: string[]; fillerWords: string[]; maxCommentRatio: number; noIssueRefs: boolean; singleOutcomeTests: boolean } | null;
  scope: boolean;
  criteriaQuality: boolean;
  testDeletion: boolean;
  guardedPaths: string[];
  exclusivePaths: string[];
  declarations: Array<{ name: string; when: string }>;
  handoffNote: boolean;
  criteriaChecked: boolean;
  commitPattern: string | null;
  commitScopes: string[] | null;
  humanAuthorship: boolean;
  protectedBranches: string[];
  maxDiffLines: number;
  secretScan: boolean;
  exploitScan: boolean;
  audit: string | null;
  rollback: boolean;
  reviewApproval: boolean;
  messageApproval: boolean;
  quiz: { enabled: boolean; minLines: number; pass: number; maxAttempts: number } | null;
  monitorNotes: boolean;
}

export interface Config {
  commands: Commands;
  deploy: { requireApproval: boolean };
  tracker: TrackerConfig;
  memory: { skills: boolean; history: boolean };
  tokens: { mode: 'compact' | 'full'; outputLines: number; pointerFiles: boolean };
  practices: Practices;
  graph: { enabled: boolean; maxFiles: number; maxFileKb: number; ignore: string[] };
  assistants: string[];
  approvals: 'prompt' | 'command';
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface GateResult {
  phase: Phase;
  pass: boolean;
  checks: Check[];
}

export interface HistoryEntry {
  phase: Phase;
  at: string;
  pass: boolean;
  advanced: boolean;
  checks: Check[];
}

export interface Issue {
  id?: string;
  key: string;
  title: string;
  description: string;
  url: string | null;
  state?: string | null;
  updatedAt?: string | null;
  repo?: string;
  number?: number;
}

export interface TokenBucket {
  raw: number;
  shown: number;
  count: number;
}

export interface RedRun {
  at: string;
  code: number;
  testFiles: string[];
  summary: string;
}

export interface ReviewRecord {
  at: string;
  file: string;
  source: 'command' | 'file' | 'stdin';
  critical: number;
  major: number;
  minor: number;
}

export interface PullRequestRecord {
  number: number;
  url: string;
  head: string;
  base: string;
  at: string;
  merged?: boolean;
  mergedAt?: string | null;
}

export interface QuizOption {
  letter: string;
  text: string;
}

export interface QuizQuestion {
  n: number;
  text: string;
  options: QuizOption[];
  answer: string;
}

export interface QuizRecord {
  at: string;
  total: number;
  correct: number;
  missed: number[];
  attempts: number;
  passed: boolean;
  questions: QuizQuestion[];
}

export interface Finding {
  severity: 'critical' | 'major' | 'minor';
  text: string;
  file?: string;
  line?: number;
}

export interface Cycle {
  id: string;
  goal: string;
  phase: Phase;
  startedAt: string;
  startCommit: string | null;
  configHash: string;
  configText?: string;
  issue: Issue | null;
  approvals: Record<string, { at: string; hash?: string }>;
  history: HistoryEntry[];
  usedSkills?: string[];
  tokens?: Record<string, TokenBucket>;
  red?: RedRun[];
  review?: ReviewRecord;
  quiz?: QuizRecord;
  worktree?: string;
  pr?: PullRequestRecord;
  debt?: string[];
  status?: string;
  endedAt?: string;
}

export interface State {
  cycle: Cycle | null;
}

export interface GateContext {
  root: string;
  config: Config;
  cycle: Cycle;
  phase?: Phase;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>;

export interface Tracker {
  name: Provider;
  fetchIssue(ref: string): Promise<Issue>;
  comment(issue: Issue, body: string): Promise<void>;
  transition(issue: Issue, stateName: string): Promise<void>;
}

export type TrackerEvent =
  | { type: 'started'; to: Phase }
  | { type: 'advanced'; from: Phase; to: Phase }
  | { type: 'complete' }
  | { type: 'abandoned' };

export interface SkillMeta {
  name: string;
  title?: string;
  created?: string;
  updated?: string;
  runs: number;
  completed: number;
  abandoned: number;
  gateFailures: number;
  lastCycle?: string;
  tags: string[];
}

export interface Skill extends SkillMeta {
  file: string;
  scope: 'project' | 'global';
  body: string;
}

export type SkillHealth = 'new' | 'healthy' | 'underperforming';

export interface SkillMatch extends Skill {
  score: number;
  matched: number;
  coverage: number;
  strong: boolean;
  health: SkillHealth;
}

export interface Deps {
  env: Env;
  fetchImpl: FetchLike;
  home: string;
  stderr: Writer;
  stdin?: Record<string, unknown>;
  stdinText?: string;
}

export type Flags = Record<string, string | boolean | undefined>;
