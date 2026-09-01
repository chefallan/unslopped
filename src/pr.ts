import fs from 'node:fs';
import path from 'node:path';
import { githubRepo, githubToken } from './detect.ts';
import { commitSubjects, currentBranch, pushBranch } from './git.ts';
import { createPr, createReview, defaultBranch, findOpenPr, getPr, getPrDiff, getPrFiles, githubClient, prBody, prTitle, reviewPayload, rightSideLines } from './github.ts';
import { matchesAny, parseFindings, planSection, scanDiffText } from './practices.ts';
import { ensureGraph } from './graph.ts';
import { changedLinesFromPatches, computeImpact, impactFindings, impactSection, localChanges } from './impact.ts';
import { runCommand } from './run.ts';
import { loadState, planPath, saveState, stateDir } from './state.ts';
import { createTracker, mergeTracker } from './tracker.ts';
import { digest } from './tokens.ts';
import { readStdinText } from './hooks.ts';
import type { Config, Cycle, Deps, Flags, ReviewRecord, State, Writer } from './types.ts';
import type { GithubClient } from './github.ts';

function out(io: Writer, line = ''): void {
  io.write(line + '\n');
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of counts) {
    if (c > n) {
      best = v;
      n = c;
    }
  }
  return best;
}

export function client(root: string, config: Config, deps: Deps): GithubClient {
  const repo = githubRepo(root, config.tracker.github.repo, deps.env);
  if (!repo) throw new Error('no GitHub repository found. set tracker.github.repo, GITHUB_REPOSITORY, or add a github.com origin remote');
  const token = githubToken(deps.env);
  if (!token) throw new Error('no GitHub token. set GITHUB_TOKEN or GH_TOKEN, or log in with gh auth login');
  return githubClient(repo, token, deps.env, deps.fetchImpl);
}

async function tellTracker(config: Config, cycle: Cycle, message: string, transition: string | null, io: Writer, deps: Deps): Promise<void> {
  if (!cycle.issue) return;
  try {
    const tracker = createTracker(config, deps.env, deps.fetchImpl);
    if (!tracker) return;
    const t = mergeTracker(config.tracker);
    if (t.comments) await tracker.comment(cycle.issue, message);
    if (transition) await tracker.transition(cycle.issue, transition);
  } catch (e) {
    out(io, `WARN tracker: ${(e as Error).message}`);
  }
}

export async function openPullRequest(io: Writer, root: string, config: Config, state: State, deps: Deps, { draft }: { draft?: boolean } = {}): Promise<number> {
  const cycle = state.cycle;
  if (!cycle) {
    out(io, 'error: no active cycle. run: unslopped start "<goal>"');
    return 2;
  }
  const branch = currentBranch(root);
  if (!branch) {
    out(io, 'error: detached HEAD, check out a branch first');
    return 2;
  }
  if (config.practices.protectedBranches.includes(branch)) {
    out(io, `error: ${branch} is a protected branch. work on a feature branch (unslopped start --worktree) and open the PR from there`);
    return 2;
  }
  let gh: GithubClient;
  try {
    gh = client(root, config, deps);
  } catch (e) {
    out(io, `error: ${(e as Error).message}`);
    return 2;
  }
  if (cycle.pr) {
    out(io, `pull request already open: #${cycle.pr.number} ${cycle.pr.url}`);
    return 0;
  }
  const push = pushBranch(root, branch);
  if (!push.ok) {
    out(io, `error: git push failed: ${push.err || push.out}`);
    return 1;
  }
  out(io, `pushed ${branch} to origin`);
  try {
    const existing = await findOpenPr(gh, branch);
    const base = config.practices.pullRequest.base ?? (await defaultBranch(gh));
    const plan = fs.existsSync(planPath(root, cycle.id)) ? fs.readFileSync(planPath(root, cycle.id), 'utf8') : '';
    const changed = localChanges(root, cycle.startCommit);
    const guarded = [...changed.keys()].filter((f) => matchesAny(f, config.practices.guardedPaths));

    const reviewFocus: string[] = [];
    const judgment = planSection(plan, 'Judgment calls').trim();
    if (judgment) reviewFocus.push('Decisions a reviewer could reasonably push back on:', judgment);
    if (guarded.length) reviewFocus.push(`Guarded paths touched, review with care: ${guarded.join(', ')}`);
    for (const d of config.practices.declarations) {
      const line = plan.match(new RegExp(`^\\s*(?:[-*]\\s*)?(${d.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*.+)$`, 'im'));
      if (line) reviewFocus.push(line[1].trim());
    }

    let body = prBody(cycle, plan, gh.repo, reviewFocus);
    const graph = ensureGraph(root, config.graph);
    if (graph && changed.size) body += `\n${impactSection(computeImpact(graph, changed, config.practices.testPatterns))}\n`;

    const area = mostCommon([...changed.keys()].filter((f) => f.includes('/')).map((f) => f.split('/')[0]));
    const title = prTitle(cycle, { conventional: Boolean(config.practices.commitPattern), subjects: commitSubjects(cycle.startCommit, root).filter((s) => !/^Merge /.test(s)), area });
    const pr = existing ?? (await createPr(gh, { head: branch, base, title, body, draft: draft ?? config.practices.pullRequest.draft }));
    cycle.pr = { number: pr.number, url: pr.html_url, head: branch, base: pr.base?.ref ?? base, at: new Date().toISOString(), merged: Boolean(pr.merged), mergedAt: pr.merged_at ?? null };
    saveState(root, state);
    out(io, `${existing ? 'found open' : 'opened'} pull request #${pr.number}: ${pr.html_url}`);
    await tellTracker(config, cycle, `unslopped cycle ${cycle.id}: pull request ${existing ? 'linked' : 'opened'} ${pr.html_url}`, null, io, deps);
    return 0;
  } catch (e) {
    out(io, `error: ${(e as Error).message}`);
    return 1;
  }
}

export async function pullRequestStatus(io: Writer, root: string, config: Config, state: State, deps: Deps, number: number | null): Promise<number> {
  const cycle = state.cycle;
  const n = number ?? cycle?.pr?.number ?? null;
  if (!n) {
    out(io, 'error: no pull request recorded for this cycle. run: unslopped pr, or pass --number=<n>');
    return 2;
  }
  let gh: GithubClient;
  try {
    gh = client(root, config, deps);
  } catch (e) {
    out(io, `error: ${(e as Error).message}`);
    return 2;
  }
  try {
    const pr = await getPr(gh, n);
    out(io, `#${pr.number} ${pr.title}`);
    out(io, `state   ${pr.merged ? 'merged' : pr.state}${pr.draft ? ' (draft)' : ''}`);
    out(io, `branch  ${pr.head.ref} -> ${pr.base.ref}`);
    out(io, `url     ${pr.html_url}`);
    if (cycle?.pr && cycle.pr.number === n) {
      const newlyMerged = pr.merged && !cycle.pr.merged;
      cycle.pr.merged = pr.merged;
      cycle.pr.mergedAt = pr.merged_at;
      saveState(root, state);
      if (newlyMerged) {
        const done = mergeTracker(config.tracker).transitions.done ?? null;
        await tellTracker(config, cycle, `unslopped cycle ${cycle.id}: pull request merged ${pr.html_url}`, done, io, deps);
        if (cycle.issue) out(io, `issue ${cycle.issue.key} told the PR merged${done ? ` and moved to ${done}` : ''}`);
      }
    }
    return 0;
  } catch (e) {
    out(io, `error: ${(e as Error).message}`);
    return 1;
  }
}

export async function reviewPullRequest(io: Writer, root: string, config: Config, deps: Deps, number: number, flags: Flags): Promise<number> {
  let gh: GithubClient;
  try {
    gh = client(root, config, deps);
  } catch (e) {
    out(io, `error: ${(e as Error).message}`);
    return 2;
  }
  const dir = path.join(stateDir(root), 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  const reviewFile = path.join(dir, `pr-${number}.md`);
  const diffFile = path.join(dir, `pr-${number}.diff`);
  try {
    const pr = await getPr(gh, number);
    const files = await getPrFiles(gh, number);
    const diff = await getPrDiff(gh, number);
    fs.writeFileSync(diffFile, diff);
    out(io, `reviewing #${pr.number} ${pr.title} (${files.length} file(s), ${pr.head.ref} -> ${pr.base.ref})`);

    let text = '';
    let source: ReviewRecord['source'];
    const fromFile = typeof flags.file === 'string' ? flags.file : null;
    if (fromFile) {
      text = fs.readFileSync(fromFile, 'utf8');
      source = 'file';
    } else if (config.practices.reviewCommand) {
      out(io, `running reviewer: ${config.practices.reviewCommand}`);
      const before = fs.existsSync(reviewFile) ? fs.statSync(reviewFile).mtimeMs : 0;
      const r = runCommand(config.practices.reviewCommand, root, {
        env: {
          UNSLOPPED_PR_NUMBER: String(pr.number),
          UNSLOPPED_PR_URL: pr.html_url,
          UNSLOPPED_PR_DIFF_FILE: diffFile,
          UNSLOPPED_REVIEW_FILE: reviewFile,
          UNSLOPPED_BASE_COMMIT: pr.base.sha,
          UNSLOPPED_HEAD_COMMIT: pr.head.sha,
          UNSLOPPED_ROOT: root,
        },
      });
      if (r.code !== 0) {
        out(io, `reviewer exited ${r.code}`);
        out(io, digest(r.output, { lines: config.tokens.outputLines }).text);
        return 1;
      }
      const wroteFile = fs.existsSync(reviewFile) && fs.statSync(reviewFile).mtimeMs > before;
      text = wroteFile ? fs.readFileSync(reviewFile, 'utf8') : r.output;
      source = 'command';
    } else {
      text = deps.stdinText ?? readStdinText();
      source = 'stdin';
      if (!text.trim()) {
        out(io, 'error: no review input. set practices.reviewCommand, pass --file=<review.md>, or pipe findings on stdin');
        return 2;
      }
    }
    const secrets = scanDiffText(diff);
    if (secrets.length) {
      const auto = secrets.map((h) => `- [critical] ${h.file}:${h.line} looks like a real ${h.name}: remove it, load it from an environment variable, and rotate the value`).join('\n');
      text = `${auto}\n${text}`;
      out(io, `${secrets.length} credential-looking line(s) in the PR diff added as critical findings`);
    }
    let impactNote = '';
    const graph = ensureGraph(root, config.graph);
    if (graph) {
      const impact = computeImpact(graph, changedLinesFromPatches(files), config.practices.testPatterns);
      const extra = impactFindings(impact);
      if (extra.length) {
        text = `${extra.map((f) => `- [major] ${f.text}`).join('\n')}\n${text}`;
        out(io, `${extra.length} impact finding(s) added (changed hot exports without tests)`);
      }
      impactNote = `\n\n${impactSection(impact)}`;
      out(io, `impact: ${impact.transitive} dependent file(s) within 3 hops${impact.hot.length ? `, hot: ${impact.hot.map((h) => h.symbol).join(', ')}` : ''}`);
    }
    fs.writeFileSync(reviewFile, text.endsWith('\n') ? text : text + '\n');
    const findings = parseFindings(text);
    const counts = { critical: 0, major: 0, minor: 0 };
    for (const f of findings) counts[f.severity]++;
    out(io, `findings: ${counts.critical} critical, ${counts.major} major, ${counts.minor} minor (from ${source}), saved to ${path.relative(root, reviewFile).replace(/\\/g, '/')}`);

    const state = loadState(root);
    if (state.cycle?.pr?.number === number) {
      state.cycle.review = { at: new Date().toISOString(), file: path.relative(root, reviewFile).replace(/\\/g, '/'), source, ...counts };
      saveState(root, state);
    }

    if (flags['no-post']) return counts.critical ? 1 : 0;
    const allowed = new Map(files.map((f) => [f.filename, rightSideLines(f.patch)]));
    const payload = reviewPayload(findings, allowed, { approve: Boolean(flags.approve), header: `Unslopped review of #${pr.number} at ${pr.head.sha.slice(0, 7)}` });
    payload.body += impactNote;
    const posted = await createReview(gh, number, { commit_id: pr.head.sha, ...payload });
    out(io, `posted ${payload.event} review with ${payload.comments.length} inline comment(s): ${posted.html_url}`);
    return counts.critical ? 1 : 0;
  } catch (e) {
    out(io, `error: ${(e as Error).message}`);
    return 1;
  }
}
