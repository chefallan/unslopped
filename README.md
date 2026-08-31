# Awesome Delivery Engine

`ade` is a delivery gatekeeper for AI coding assistants. One prompt goes in; verified software comes out. Every phase of the lifecycle ends in a gate that runs real commands and reads exit codes, so an assistant cannot advance by claiming success. It has to earn it.

Works with Claude Code, Cursor, Copilot, Codex, Gemini CLI, Windsurf, OpenCode, Cline, Roo, Kilo, Continue, Goose and anything else that reads instruction files or runs shell commands.

## The idea

Assistants are strong at writing code and weak at knowing when to stop trusting themselves. `ade` splits the work: the assistant thinks, plans and implements; the engine verifies, remembers and reports. Claims carry no weight anywhere in the loop. Tests must run red before green, reviews must be newer than the code they review, criteria must be ticked and covered, secrets are caught and redacted, and production needs a human.

## Quick start

Once per machine:

```sh
npm i -g awesome-delivery-engine
ade install
```

`install` registers hooks for Claude Code (context on every prompt, dangerous tool calls denied before they run) and Cursor (shell commands denied), and writes global rules for Codex, Gemini, Windsurf, Copilot, OpenCode, Cline, Roo, Kilo, Continue and Goose. Existing settings are preserved; `ade uninstall` removes exactly what was added.

Once per project (or let the assistant do it, the protocol tells it to):

```sh
ade init
```

`init` detects the build, lint, test, setup, audit and deploy commands (npm, pnpm, yarn, bun, Cargo, Go, Python, Make), detects the project tracker, writes the protocol into the assistant instruction files, installs git hooks that refresh the code map, and creates the state directory. `--all` covers every supported assistant file, `--ci` adds a GitHub Actions review workflow and a PR template, `--tracker=<name>` overrides detection.

Then give the assistant one prompt. It runs `ade start "<the request>"` and works through the phases; you approve the deploy.

## How a cycle runs

Eight phases, one active cycle per repository, state in `.ade/`. Each row's gate runs when the assistant calls `ade next`.

| Phase | The work | The gate |
|---|---|---|
| plan | Goal, approach with rejected options, files to touch, acceptance criteria, open questions | Required sections filled, at least one criterion, criteria are observable outcomes |
| code | Failing test first (`ade red`), then the smallest change that goes green | Changes exist and are declared in the plan, tests changed with source, none deleted, diff under the size limit, no secrets, style clean, lint passes |
| build | Nothing to write | Build, dependency audit and security scan exit 0 |
| test | Fix the code, never the test | Tests pass, a red run is on record, coverage above the minimum |
| release | Tick verified criteria, update the changelog, commit as `type(scope): subject` | Clean tree, new commits, criteria ticked, commit format, no open questions, review artifact without critical findings, human review approval where required |
| deploy | Open the PR (`ade pr`), then stop for the human | `ade approve deploy` recorded, rollback command defined, deploy exits 0 |
| operate | Report the healthcheck | Healthcheck exits 0, rollback printed on failure |
| monitor | Write what was learned | Monitor command exits 0, notes present after a rough cycle, handoff posted, cycle archived |

The loop closes through records rather than through magic: when a cycle completes, `ade` prints ready-to-paste candidates for the next one, drawn from the monitor notes, the open debt log and unresolved review findings, and the protocol tells the assistant to offer them rather than start one unasked. `ade start --from-debt` begins a sweep cycle whose plan is seeded from the debt log; the swept entries leave the log when that cycle completes.

Nothing can be gamed mid-cycle: the config is hashed when a cycle starts, and changing it blocks every gate until a human runs `ade approve config`. `approve`, `reset` and `rollback` are human-only, and on Claude Code and Cursor the hooks deny them to the assistant before they execute, along with force pushes, `--no-verify` and writes to `.ade/` state.

## Commands

Lifecycle:

```
ade init [--force] [--all] [--only=claude,cursor] [--tracker=<name>] [--ci]
ade status [--json]
ade resume                         where the cycle stands and what to do next (alias: continue)
ade start "<goal>" [--issue=KEY] [--no-issue] [--worktree] [--from-debt[=cleanup|pattern|soon|all]]
ade next [--json] [--full]         run the current gate, advance on pass
ade check [--json] [--full]        run the current gate without advancing
ade red                            run the tests expecting a failure, record the evidence
ade log                            gate history for the active cycle
ade reset ["<goal>"]               abandon the cycle (humans only); with a goal, start the next one in the same step
```

Humans in the loop:

```
ade approve deploy|config|review
ade rollback                       run commands.rollback (humans only)
```

Reviews and pull requests:

```
ade review [--file=review.md]                    record a review for the cycle
ade review --pr=<n> [--approve] [--no-post]      review a GitHub PR, post inline findings
ade pr [--draft]                                 push the branch, open the PR from the plan
ade pr status [--number=<n>]                     follow the PR; a merge moves the issue to done
```

Knowledge:

```
ade graph ["<words>"]              query the code map, or print it
ade graph node <file>              one file: symbols, rationale, imports, importers
ade graph path <from> <to>         shortest import chain between two files
ade graph why "<topic>"            design rationale and debt markers mined from comments
ade graph impact [--since=<ref>]   what the changes touch, who depends on it, test coverage
ade graph report | html | refresh  write .ade/GRAPH.md or .ade/graph.html, or rebuild
ade recall "<words>"               full-text search over cycles, plans, prompts, skills
```

Records:

```
ade skills | ade skill show|save|rm    learned playbooks with health tracking
ade debt ["<what>"]                    log a deviation instead of fixing it out of scope
ade decide ["<title>"]                 scaffold or list decision records in docs/decisions/
ade prefer "<statement>" [--project]   remember a preference across sessions
ade profile                            show remembered and detected preferences
```

Numbers:

```
ade metrics [--json]               lead time, deploy frequency, change failure rate, recovery
ade tokens [--json]                context spent vs saved by digests and dedupe
ade tracker [--issue=KEY]          tracker detection, credentials, issue lookup
```

Plumbing, called by hook systems rather than people:

```
ade install | ade uninstall [--only=...]
ade hook claude session|prompt|tool
ade hook cursor shell
```

Exit codes everywhere: 0 ok, 1 gate failed, 2 usage or state error.

## What the gates enforce

Each practice is a mechanical check, on by default unless noted, switchable under `practices` in `ade.config.json`, and part of the hashed config so it cannot be turned off mid-cycle.

| Practice | Check |
|---|---|
| Design before code | Goal, Approach and Files to touch must be filled before leaving plan; the protocol asks design questions first and records rejected options |
| Scope | every changed file must be listed in the plan; widening scope means editing the plan, visibly |
| Criteria quality | criteria must be observable outcomes; guarded work needs a rejection case; open questions block release |
| Red before green | `ade red` records the failing run; the test gate demands it when source and tests both changed |
| Test evidence and retention | source changes require test changes; deleting or gutting a test requires a written justification |
| Coverage floor | optional coverage command with a minimum percentage (istanbul, jest, pytest-cov, go, tarpaulin formats) |
| Small batches | the diff since cycle start stays under a line limit (400 by default) |
| Secrets | added lines are scanned for AWS, GitHub, GitLab, npm, PyPI, Slack, Stripe, SendGrid, Twilio, Telegram, Google, GCP, Azure, OpenAI, Anthropic and Linear credentials, private keys, JWTs, bearer tokens, connection strings, committed env files and high-entropy assignments; the same patterns redact tokens from every log the engine writes, refuse credentials in the config, and become critical findings in PR reviews |
| Style | no em or en dashes in added lines, no filler words in comments and prose, comment-heavy diffs fail, no issue ids in comments, one outcome per test name |
| Commit format | Conventional Commits, subjects under 72 characters, optional scope validation |
| Guarded paths | auth, security, permissions, migrations, payments, billing and ledger paths force a human review approval and a rejection criterion, whatever the diff size |
| Exclusive paths | a change to a shared boundary ships in its own cycle (off by default) |
| Changelog and declarations | a changelog present in the repo must change; configured declarations (`Indexes: none`) are demanded when matching paths change |
| Review artifact | `ade review` findings, counted by `[critical]` `[major]` `[minor]`; critical or stale reviews block release (off by default) |
| Rollback ready | a deploy command requires a rollback command |
| Handoff | a verification note for whoever tests it, posted to the issue on completion (off by default) |

## The code map

`ade` keeps a knowledge graph of the codebase in `.ade/graph.json`: files, symbols with line numbers, resolved import edges, which exported symbols each importer uses, and the design rationale mined from comments (`because`, `so that`, `workaround`, `must`, `never`, TODO markers) and doc sections (Why, Decision, Trade-offs). Extraction is local regex over 13 languages; nothing leaves the machine, no model is called.

It refreshes itself: the Claude Code hooks refresh it per prompt, `init` installs `post-commit`, `post-checkout` and `post-merge` git hooks, and `start` refreshes before planning. Refreshes are incremental by file mtime and size. The prompt hook injects the files relevant to each request, the plan gets a `## Relevant code` section, and the protocol directs the assistant to read the map before the repository. That is where the token savings come from: a dozen lines instead of a grep-and-read expedition. `.ade/GRAPH.md` and an interactive `.ade/graph.html` (canvas force layout, offline, no libraries) regenerate on every refresh that found changes.

## Memory

Every completed cycle is saved as a skill in `.ade/skills/`: files touched, criteria that passed, gate failures with their first error line, monitor notes. New cycles get matching skills listed in the plan and reuse them instead of rediscovering the work. Skills carry run counts and failure counts; underperformers are flagged at start and mechanically refreshed on reuse. Preferences (`ade prefer "no em dashes"`) live in `~/.ade/profile.md` across all projects, with repo conventions detected from git history. `ade recall` runs BM25 search over skills, archived cycles, gate failures, plans, past prompts and preferences.

## Trackers

Linear, Jira Cloud, GitHub Issues, or any HTTP endpoint through the webhook provider. Nothing to configure: the provider is detected from env vars, project files, the git remote and MCP configs; the issue is detected from the prompt or the branch name. The issue's title and description seed the plan, every phase change posts a comment and moves the issue through configured states, and credentials come from the environment only (or `gh auth` for GitHub). Tracker failures warn and never block a gate.

## Pull requests

`ade pr` pushes the branch and opens a PR written for the reviewer: a conventional title derived from the cycle's commits, then Why, What changed and Review focus (judgment calls from the plan, guarded paths touched, declaration lines), the issue linkage, the impact analysis and the cycle summary. `ade review --pr=<n>` reviews any PR, including ones opened by people: findings with `file:line` land as inline comments, critical findings request changes and fail CI, secrets in the diff are flagged without being asked, and changed hot exports without tests become major findings. `ade init --ci` makes that run on every PR through GitHub Actions. `ade pr status` follows the merge and closes the loop with the tracker.

## Numbers

`ade metrics` computes delivery metrics from archived cycles with no external service: lead time, deployment frequency, change failure rate and recovery time (the DORA four), plus first-pass rates per gate and failures by phase, which show where the assistant keeps stumbling. `ade tokens` accounts for context: failing gate output is digested to the signal lines with the full log saved to disk, the protocol is never injected twice, and the report shows raw versus shown with estimated tokens.

## Configuration

`ade.config.json`, written by `init`, hashed per cycle:

```json
{
  "commands": {
    "setup": "npm ci",
    "lint": "npm run lint",
    "build": "npm run build",
    "test": "npm test",
    "release": null,
    "deploy": "npm run deploy",
    "rollback": "npm run rollback",
    "healthcheck": "curl -fsS https://acme.example/health",
    "monitor": null
  },
  "deploy": { "requireApproval": true },
  "tracker": {
    "provider": "linear",
    "comments": true,
    "transitions": { "code": "In Progress", "release": "In Review", "done": "Done" }
  },
  "memory": { "skills": true, "history": true },
  "tokens": { "mode": "compact", "outputLines": 25, "pointerFiles": true },
  "graph": { "enabled": true, "maxFiles": 20000, "maxFileKb": 512 },
  "practices": {
    "planSections": ["Goal", "Approach", "Files to touch"],
    "scope": true,
    "criteriaQuality": true,
    "testEvidence": true,
    "testDeletion": true,
    "tdd": true,
    "coverage": null,
    "maxDiffLines": 400,
    "secretScan": true,
    "style": { "forbidden": ["\\u2014", "\\u2013"], "maxCommentRatio": 0.25 },
    "commitPattern": "^(feat|fix|chore|docs|refactor|test|build|ci|perf|style|revert)(\\([^)]+\\))?!?: .+",
    "commitScopes": null,
    "changelog": true,
    "protectedBranches": ["main", "master"],
    "guardedPaths": ["**/auth/**", "**/security/**", "**/permissions/**", "**/migrations/**", "**/payments/**", "**/billing/**", "**/ledger/**"],
    "exclusivePaths": [],
    "declarations": [],
    "audit": "npm audit --audit-level=high",
    "securityScan": null,
    "reviewArtifact": false,
    "reviewCommand": null,
    "reviewApproval": false,
    "rollback": true,
    "monitorNotes": true,
    "handoffNote": false,
    "worktree": false,
    "pullRequest": { "auto": false, "base": null, "draft": false }
  }
}
```

Environment: `LINEAR_API_KEY`, `JIRA_EMAIL` + `JIRA_API_TOKEN` + `JIRA_BASE_URL`, `GITHUB_TOKEN` or `gh auth`, `ADE_WEBHOOK_URL` + `ADE_WEBHOOK_TOKEN`, `ADE_GITHUB_API` for GitHub Enterprise, `ADE_HOME` to relocate the global directory.

## Isolation and recovery

`ade start --worktree` runs the whole cycle in its own git worktree on a fresh branch, with `commands.setup` applied, leaving the main checkout untouched. `ade rollback` runs the configured undo, records it in the cycle history, and stays human-only.

One cycle is active per repository. Coming back to it, `ade resume` prints where it stands, the failing checks from the last gate run and the next actions. Walking away from it, `ade reset "<new goal>"` archives it as abandoned and starts the replacement in one command; `ade start` also warns when uncommitted files predate the cycle, so the baseline stays clean and the diff gates measure only the cycle's own work.

## Requirements

Node 18+ and git at runtime. No runtime dependencies. Written in TypeScript, shipped as compiled JavaScript; development needs Node 22.6+ (`npm run build`, `npm test`, `npm run typecheck`).

## License

MIT
