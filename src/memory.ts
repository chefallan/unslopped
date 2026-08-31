import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stateDir, planPath, archivedCycles } from './state.ts';
import { acceptanceCriteria } from './gates.ts';
import { tokenize, rank, snippet } from './search.ts';
import type { Cycle, Env, HistoryEntry, Skill, SkillHealth, SkillMatch, SkillMeta } from './types.ts';

export function homeDir(env: Env = process.env): string {
  return env.ADE_HOME ?? os.homedir();
}

export function globalDir(home: string): string {
  return path.join(home, '.ade');
}

export function skillsDir(root: string): string {
  return path.join(stateDir(root), 'skills');
}

export function globalSkillsDir(home: string): string {
  return path.join(globalDir(home), 'skills');
}

export function profilePath(root: string): string {
  return path.join(stateDir(root), 'profile.md');
}

export function globalProfilePath(home: string): string {
  return path.join(globalDir(home), 'profile.md');
}

export function historyPath(root: string): string {
  return path.join(stateDir(root), 'history.jsonl');
}

function read(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function slugify(title: string): string {
  return (
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'skill'
  );
}

const NUMERIC = new Set(['runs', 'completed', 'abandoned', 'gateFailures']);

export type RawMeta = Record<string, string | number | string[]>;

export function parseSkill(text: string): { meta: RawMeta; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta: RawMeta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    meta[key] = NUMERIC.has(key) ? Number(value) || 0 : value;
  }
  if (typeof meta.tags === 'string') meta.tags = meta.tags.split(',').map((t) => t.trim()).filter(Boolean);
  return { meta, body: m[2] };
}

export function renderSkill(meta: RawMeta | SkillMeta, body: string): string {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
  return `---\n${lines.join('\n')}\n---\n${body.replace(/^\n+/, '')}`;
}

export function getSection(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return '';
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^##\s/.test(l)) break;
    out.push(l);
  }
  return out.join('\n').trim();
}

export function setSection(body: string, heading: string, content: string): string {
  const block = `## ${heading}\n${content.trim()}\n`;
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return body.trimEnd() + `\n\n${block}`;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start), ...block.trimEnd().split('\n'), '', ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n');
}

function toSkill(meta: RawMeta, body: string, file: string, scope: Skill['scope']): Skill {
  const num = (k: string) => Number(meta[k] ?? 0) || 0;
  const str = (k: string) => (typeof meta[k] === 'string' ? (meta[k] as string) : undefined);
  return {
    name: str('name') ?? path.basename(file, '.md'),
    title: str('title'),
    created: str('created'),
    updated: str('updated'),
    lastCycle: str('lastCycle'),
    runs: num('runs'),
    completed: num('completed'),
    abandoned: num('abandoned'),
    gateFailures: num('gateFailures'),
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    file,
    scope,
    body,
  };
}

function readDir(dir: string, scope: Skill['scope']): Skill[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const file = path.join(dir, f);
      const { meta, body } = parseSkill(read(file));
      return toSkill(meta, body, file, scope);
    });
}

export function listSkills(root: string, home: string): Skill[] {
  return [...readDir(skillsDir(root), 'project'), ...readDir(globalSkillsDir(home), 'global')];
}

export function loadSkill(root: string, home: string, name: string): Skill | null {
  return listSkills(root, home).find((s) => s.name === name) ?? null;
}

export function health(meta: Pick<SkillMeta, 'runs'> & Partial<SkillMeta>): SkillHealth {
  const runs = Number(meta.runs ?? 0);
  if (runs < 2) return 'new';
  const completed = Number(meta.completed ?? 0);
  const failures = Number(meta.gateFailures ?? 0);
  if (completed / runs < 0.5 || failures / runs >= 2) return 'underperforming';
  return 'healthy';
}

function skillText(s: Skill): string {
  return `${s.title ?? s.name} ${s.title ?? s.name} ${s.tags.join(' ')} ${getSection(s.body, 'When to use')} ${s.body}`;
}

export function matchSkills(root: string, home: string, query: string, limit = 3): SkillMatch[] {
  const skills = listSkills(root, home);
  const ranked = rank(query, skills.map((s) => ({ ...s, text: skillText(s) })), limit);
  const q = new Set(tokenize(query));
  return ranked.map((r) => {
    const head = new Set(tokenize(`${r.title ?? r.name} ${r.tags.join(' ')}`));
    const headHits = [...q].filter((w) => head.has(w)).length;
    const { text, ...rest } = r;
    return { ...rest, strong: headHits >= Math.min(2, q.size) && headHits / Math.max(q.size, 1) >= 0.5, health: health(r) };
  });
}

function changedFiles(root: string, since: string | null): string[] {
  const args = since ? ['diff', '--name-only', `${since}..HEAD`] : ['show', '--name-only', '--format=', 'HEAD'];
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('.ade/'));
}

interface FailureSummary {
  phase: string;
  check: string;
  count: number;
  detail: string;
}

function summarizeFailures(history: HistoryEntry[]): FailureSummary[] {
  const seen = new Map<string, FailureSummary>();
  for (const h of history ?? []) {
    if (h.pass) continue;
    for (const c of h.checks ?? []) {
      if (c.ok) continue;
      const key = `${h.phase}/${c.name}`;
      const lines = String(c.detail ?? '').split('\n');
      const first = lines.find((l) => l.trim() && !/\(exit \d+, \d+ms\)/.test(l)) ?? lines[0] ?? '';
      const e = seen.get(key) ?? { phase: h.phase, check: c.name, count: 0, detail: first.trim().slice(0, 140) };
      e.count++;
      seen.set(key, e);
    }
  }
  return [...seen.values()];
}

function mergeFailureLines(existing: string, fresh: FailureSummary[]): string {
  const lines = new Set(existing.split('\n').map((l) => l.trim()).filter(Boolean));
  for (const f of fresh) lines.add(`- ${f.phase} gate, ${f.check} failed ${f.count} time(s): ${f.detail}`);
  return [...lines].join('\n') || '- none recorded';
}

function tagsFor(goal: string, files: string[]): string[] {
  const dirs = new Set(files.map((f) => f.split('/')[0]).filter((d) => d && !d.includes('.')));
  return [...new Set([...tokenize(goal).slice(0, 8), ...dirs])];
}

function playbook(files: string[], criteria: string[], history: HistoryEntry[]): string {
  const failed = (history ?? []).filter((h) => !h.pass).length;
  return [
    'Files touched:',
    ...(files.length ? files.map((f) => `- ${f}`) : ['- none recorded']),
    '',
    'Acceptance criteria that passed:',
    ...(criteria.length ? criteria.map((c) => `- ${c}`) : ['- none recorded']),
    '',
    `Gate runs: ${(history ?? []).length} (${failed} failed)`,
  ].join('\n');
}

function uniqueName(dir: string, base: string): string {
  let name = base;
  let n = 2;
  while (fs.existsSync(path.join(dir, `${name}.md`))) name = `${base}-${n++}`;
  return name;
}

function metaOf(skill: Skill): SkillMeta {
  const { file, scope, body, ...meta } = skill;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) if (v !== undefined) clean[k] = v;
  return clean as unknown as SkillMeta;
}

export interface Learned {
  action: 'created' | 'updated' | 'none';
  name?: string;
  file?: string;
  health?: SkillHealth;
}

export function learnFromCycle(root: string, home: string, cycle: Cycle, status: 'complete' | 'abandoned'): Learned {
  const now = new Date().toISOString();
  const gateFailures = (cycle.history ?? []).filter((h) => !h.pass).length;
  const used = cycle.usedSkills?.[0];
  const existing = used ? loadSkill(root, home, used) : null;

  if (status !== 'complete') {
    if (!existing) return { action: 'none' };
    const meta: SkillMeta = { ...metaOf(existing), runs: existing.runs + 1, abandoned: existing.abandoned + 1, gateFailures: existing.gateFailures + gateFailures, updated: now };
    write(existing.file, renderSkill(meta, existing.body));
    return { action: 'updated', name: existing.name, file: existing.file, health: health(meta) };
  }

  const files = changedFiles(root, cycle.startCommit);
  const plan = read(planPath(root, cycle.id));
  const criteria = acceptanceCriteria(plan);
  const monitor = getSection(plan, 'Monitor');
  const failures = summarizeFailures(cycle.history);

  if (existing) {
    const meta: SkillMeta = { ...metaOf(existing), runs: existing.runs + 1, completed: existing.completed + 1, gateFailures: existing.gateFailures + gateFailures, updated: now, lastCycle: cycle.id };
    let body = existing.body;
    const when = getSection(body, 'When to use');
    if (!when.includes(cycle.goal)) body = setSection(body, 'When to use', `${when}\n- "${cycle.goal}"`.trim());
    body = setSection(body, 'Playbook', playbook(files, criteria, cycle.history));
    body = setSection(body, 'Known failures', mergeFailureLines(getSection(body, 'Known failures'), failures));
    if (monitor) body = setSection(body, 'Notes', `${getSection(body, 'Notes')}\n${monitor}`.trim());
    write(existing.file, renderSkill(meta, body));
    return { action: 'updated', name: existing.name, file: existing.file, health: health(meta) };
  }

  const dir = skillsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const name = uniqueName(dir, slugify(cycle.goal));
  const meta: SkillMeta = { name, title: cycle.goal, created: now, updated: now, runs: 1, completed: 1, abandoned: 0, gateFailures, lastCycle: cycle.id, tags: tagsFor(cycle.goal, files) };
  const body = [
    `# ${cycle.goal}`,
    '',
    '## When to use',
    `Requests like:\n- "${cycle.goal}"`,
    '',
    '## Playbook',
    playbook(files, criteria, cycle.history),
    '',
    '## Known failures',
    mergeFailureLines('', failures),
    '',
    '## Notes',
    monitor || 'Add what a future run must know. This section is never overwritten by ADE.',
    '',
  ].join('\n');
  const file = path.join(dir, `${name}.md`);
  write(file, renderSkill(meta, body));
  return { action: 'created', name, file, health: 'new' };
}

export function saveSkill(dir: string, title: string, body: string, extra: { tags?: string[] } = {}): { name: string; file: string } {
  fs.mkdirSync(dir, { recursive: true });
  const base = slugify(title);
  const file = path.join(dir, `${base}.md`);
  const now = new Date().toISOString();
  const prev = fs.existsSync(file) ? toSkill(parseSkill(read(file)).meta, '', file, 'project') : null;
  const meta: SkillMeta = {
    name: base,
    title,
    created: prev?.created ?? now,
    updated: now,
    runs: prev?.runs ?? 0,
    completed: prev?.completed ?? 0,
    abandoned: prev?.abandoned ?? 0,
    gateFailures: prev?.gateFailures ?? 0,
    tags: extra.tags ?? (prev?.tags.length ? prev.tags : tokenize(title).slice(0, 8)),
  };
  const text = body.trim() ? body : `# ${title}\n\n## When to use\n\n## Playbook\n\n## Known failures\n\n## Notes\n`;
  write(file, renderSkill(meta, text.startsWith('#') ? text : `# ${title}\n\n${text}`));
  return { name: base, file };
}

export function addPreference(file: string, statement: string): boolean {
  const line = `- ${statement.trim()}`;
  const existing = read(file);
  if (existing.split(/\r?\n/).some((l) => l.trim() === line)) return false;
  const text = existing.trim() ? existing.trimEnd() + '\n' : '# Preferences\n\n## Stated\n';
  write(file, text.includes('## Stated') ? setSection(text, 'Stated', `${getSection(text, 'Stated')}\n${line}`.trim()) : text + `\n## Stated\n${line}\n`);
  return true;
}

export function detectConventions(root: string): string[] {
  const lines: string[] = [];
  const r = spawnSync('git', ['log', '-50', '--format=%s'], { cwd: root, encoding: 'utf8' });
  if (r.status === 0) {
    const subjects = r.stdout.split(/\r?\n/).filter(Boolean);
    const conventional = subjects.filter((s) => /^(feat|fix|chore|docs|refactor|test|build|ci|perf|style|revert)(\(.+\))?!?:/.test(s)).length;
    if (subjects.length >= 5 && conventional / subjects.length >= 0.6) lines.push('Commit messages follow Conventional Commits');
    const avg = subjects.reduce((a, s) => a + s.length, 0) / (subjects.length || 1);
    if (subjects.length >= 5 && avg <= 50) lines.push('Commit subjects stay under 50 characters');
  }
  const locks: Array<[string, string]> = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun'], ['package-lock.json', 'npm']];
  for (const [lock, pm] of locks) {
    if (fs.existsSync(path.join(root, lock))) {
      lines.push(`Package manager is ${pm}`);
      break;
    }
  }
  return lines;
}

export function refreshDetected(root: string): string[] {
  const detected = detectConventions(root);
  if (!detected.length) return [];
  const file = profilePath(root);
  const existing = read(file) || '# Preferences\n';
  write(file, setSection(existing, 'Detected', detected.map((d) => `- ${d}`).join('\n')));
  return detected;
}

export function readProfile(root: string, home: string): string[] {
  const lines: string[] = [];
  const sources: Array<[string, string]> = [['global', globalProfilePath(home)], ['project', profilePath(root)]];
  for (const [label, file] of sources) {
    const text = read(file);
    for (const heading of ['Stated', 'Detected']) {
      const section = getSection(text, heading);
      if (section) lines.push(...section.split(/\r?\n/).filter((l) => l.trim()).map((l) => `${l.trim()}  (${label}${heading === 'Detected' ? ', detected' : ''})`));
    }
  }
  return lines;
}

export interface HistoryRecord {
  at: string;
  prompt: string;
  cycle: string | null;
}

export function appendHistory(root: string, entry: HistoryRecord): void {
  const file = historyPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}

function readHistory(root: string): HistoryRecord[] {
  const out: HistoryRecord[] = [];
  for (const l of read(historyPath(root)).split(/\r?\n/).filter(Boolean)) {
    try {
      out.push(JSON.parse(l) as HistoryRecord);
    } catch {
      continue;
    }
  }
  return out;
}

export interface RecallResult {
  kind: 'skill' | 'cycle' | 'plan' | 'prompt' | 'preference';
  id: string;
  file: string;
  score: number;
  when: string;
  snippet: string;
}

interface RecallDoc {
  kind: RecallResult['kind'];
  id: string;
  file: string;
  text: string;
  when: string;
}

export function recall(root: string, home: string, query: string, limit = 5): RecallResult[] {
  const docs: RecallDoc[] = [];
  for (const s of listSkills(root, home)) docs.push({ kind: 'skill', id: s.name, file: s.file, text: skillText(s), when: s.updated ?? '' });
  for (const c of archivedCycles(root)) {
    const fails = (c.history ?? []).filter((h) => !h.pass).flatMap((h) => (h.checks ?? []).filter((x) => !x.ok).map((x) => `${h.phase} ${x.name} ${x.detail}`)).join('\n');
    docs.push({ kind: 'cycle', id: c.id, file: path.join(stateDir(root), 'cycles', `${c.id}.json`), text: `${c.goal}\n${c.issue?.key ?? ''} ${c.status ?? ''} ${c.phase}\n${fails}`, when: c.endedAt ?? c.startedAt ?? '' });
    const plan = read(planPath(root, c.id));
    if (plan) docs.push({ kind: 'plan', id: c.id, file: planPath(root, c.id), text: plan, when: c.startedAt ?? '' });
  }
  for (const h of readHistory(root)) docs.push({ kind: 'prompt', id: h.at, file: historyPath(root), text: h.prompt ?? '', when: h.at });
  for (const line of readProfile(root, home)) docs.push({ kind: 'preference', id: line, file: '', text: line, when: '' });
  return rank(query, docs, limit).map((r) => ({ kind: r.kind, id: r.id, file: r.file, score: Number(r.score.toFixed(2)), when: r.when, snippet: snippet(r.text, query) }));
}
