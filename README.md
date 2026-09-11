# unslopped

`unslopped` keeps AI coding assistants from shipping slop. One prompt goes in; verified software comes out. In between sit eight gates that run real commands and read real exit codes, because "all tests pass" is a sentence, not a test run. Assistants are brilliant at writing code and unbeatable at declaring victory, so nothing here advances on a claim. It has to earn it.

Works with Claude Code, Cursor, Copilot, Codex, Gemini CLI, Windsurf, OpenCode, Cline, Roo, Kilo, Continue, Goose and anything else that reads instruction files or runs shell commands.

## The idea

Assistants are strong at writing code and weak at knowing when to stop trusting themselves. `unslopped` splits the work: the assistant thinks, plans and implements; the engine verifies, remembers and reports. Claims carry no weight anywhere in the loop. Tests must run red before green, reviews must be newer than the code they review, criteria must be ticked and covered, secrets are caught and redacted, and production needs a human.

## Quick start

Once per machine:

```sh
npm i -g unslopped
unslopped install
```

`install` registers hooks for Claude Code (context on every prompt, dangerous tool calls denied before they run) and Cursor (shell commands denied), and writes global rules for Codex, Gemini, Windsurf, Copilot, OpenCode, Cline, Roo, Kilo, Continue and Goose. On Claude Code it also allowlists the mechanical cycle commands (`commit`, `next`, `red`, `propose`, `start`) so auto mode does not stop to ask the human to run them. It does not allowlist `approve`, `reset` or `rollback`: those stay off the allowlist on purpose, so they keep raising the human prompt. Existing settings are preserved; `unslopped uninstall` removes exactly what was added.

Once per project (or let the assistant do it, the protocol tells it to):

```sh
unslopped init
```

`init` detects the build, lint, test, setup, audit and deploy commands (npm, pnpm, yarn, bun, Cargo, Go, Python, Make), detects the project tracker, writes the protocol into the assistant instruction files, installs git hooks that refresh the code map, and creates the state directory. `--all` covers every supported assistant file, `--ci` adds a GitHub Actions review workflow and a PR template, `--tracker=<name>` overrides detection.

Then give the assistant one prompt. It runs `unslopped start "<the request>"` and works through the phases; you approve the deploy.

## The journey

Three actors run every task. You decide, the assistant thinks and types, the engine verifies and remembers.

1. **You** say what you want, once. The hook wraps your prompt with the active cycle, code map pointers, matching skills and your preferences before the assistant reads it.
2. **Assistant** runs `unslopped start "<goal>"`. Issue keys are linked, protected branches refused, and uncommitted files that predate the cycle get a warning before they can poison the diff gates.
3. **You** answer two or three design questions when the change is bigger than one file. The answers land in the plan, with the rejected options and why.
4. **Assistant** reads the code the change touches, walks the leanness ladder, and writes the rung it stopped at in the plan. The plan gate refuses an approach that names none. Then the failing test first (`unslopped red`), implement until green, advance with `unslopped next`. Each gate runs real commands: scope, tests with source, diff cap, secrets, style, build, audit, suite.
5. **You** approve the words at release. The assistant shows the full message in chat, then raises the prompt: the dialog's command line carries the verified title while the chat behind it holds the body. `unslopped commit` executes exactly the approved text, hash-checked.
6. **You** approve the pull request text (`unslopped approve pr`), then the ship itself (`unslopped approve deploy`). The PR body arrives written for the reviewer: why, what changed, the judgment calls, the impact.
7. **Engine** reviews every PR in CI with plain-language findings, flags exploitable-looking lines and leaked credentials on its own, then follows the merge and moves the issue to done.
8. **Assistant** writes what it learned under Monitor. The cycle archives, a skill is saved, swept debt clears, and candidates for the next cycle are offered, never started unasked. The report you get back is held to a contract adapted from [i-have-adhd](https://github.com/ayghri/i-have-adhd): the next action first, numbers rather than amounts, failures in the same voice as successes, long lists ranked and capped at five, one concrete next step last, no preamble and no recap.

Your moments: the design questions, one `approve commit` for each commit the cycle produces (the change, the plan, and the debt log when something was logged), `approve pr`, `approve deploy`, and the merge. Six or seven in a normal cycle, plus `approve config` on the rare occasion the config has to change mid-cycle. Turn `practices.quiz.enabled` on and there is one more: before `approve deploy` will open, you answer questions the assistant drew from the diff, and a wrong answer keeps the gate shut. Lost the thread mid-cycle? `unslopped resume` says where things stand and what to do next.

## How a cycle runs

Eight phases, one active cycle per repository, state in `.unslopped/`. Each row's gate runs when the assistant calls `unslopped next`.

| Phase | The work | The gate |
|---|---|---|
| plan | Goal, approach with rejected options, files to touch, acceptance criteria, open questions | Required sections filled, at least one criterion, criteria are observable outcomes |
| code | Failing test first (`unslopped red`), then the smallest change that goes green | Changes exist and are declared in the plan, tests changed with source, none deleted, diff under the size limit, no secrets, style clean, lint passes |
| build | Nothing to write | Build, dependency audit and security scan exit 0 |
| test | Fix the code, never the test | Tests pass, a red run is on record, coverage above the minimum |
| release | Tick verified criteria, update the changelog, commit as `type(scope): subject` | Clean tree, new commits, criteria ticked, commit format, no open questions, review artifact without critical findings, human review approval where required |
| deploy | Open the PR (`unslopped pr`), then stop for the human | `unslopped approve deploy` recorded, rollback command defined, deploy exits 0 |
| operate | Report the healthcheck | Healthcheck exits 0, rollback printed on failure |
| monitor | Write what was learned | Monitor command exits 0, notes present after a rough cycle, handoff posted, cycle archived |

The loop closes through records rather than through magic: when a cycle completes, `unslopped` prints ready-to-paste candidates for the next one, drawn from the monitor notes, the open debt log and unresolved review findings, and the protocol tells the assistant to offer them rather than start one unasked. `unslopped start --from-debt` begins a sweep cycle whose plan is seeded from the debt log; the swept entries leave the log when that cycle completes.

Nothing can be gamed mid-cycle: the config text is stored when a cycle starts, and changing it blocks every gate until a human runs `unslopped approve config`, with the changed lines shown. `approve`, `reset` and `rollback` are the human's decisions: on Claude Code and Cursor running one raises an allow-or-deny prompt for the human, and a mismatched title or cycle reference refuses even after an allow. Force pushes, `--no-verify` and writes to `.unslopped/` state stay denied outright.

## Commands

Lifecycle:

```
unslopped init [--force] [--all] [--only=claude,cursor] [--tracker=<name>] [--ci]
unslopped status [--json]
unslopped resume                         where the cycle stands and what to do next (alias: continue)
unslopped start "<goal>" [--issue=KEY] [--no-issue] [--worktree] [--from-debt[=cleanup|pattern|soon|all]]
unslopped next [--json] [--full]         run the current gate, advance on pass
unslopped check [--json] [--full]        run the current gate without advancing
unslopped red                            run the tests expecting a failure, record the evidence
unslopped log                            gate history for the active cycle
unslopped reset ["<goal>"]               abandon the cycle (humans only); with a goal, start the next one in the same step
```

Humans in the loop:

```
unslopped propose commit "<subject>" [--file=<body.md>]
                                         write the commit message for the human to review
unslopped commit                         create the commit from the approved proposal
unslopped proposals                      show pending commit and PR text with its approval state
unslopped approve deploy|config|review|commit|pr [--subject="<title>"] [--for="<cycle>"]
unslopped rollback                       run commands.rollback (humans only)
```

On Claude Code and Cursor, human decisions are one click by default: the assistant runs the command, the hook answers "ask", and your editor shows a native allow-or-deny prompt carrying the evidence. Approvals carry the deploy brief, the proposed commit message or the PR text; reset carries what would be abandoned; rollback carries the command it would run. Denying stops the assistant; nothing executes. Because permission dialogs may render only the command line, the request carries the decision in the command itself: `approve commit --subject="<proposed title>"` and `approve deploy --for="<cycle id and goal>"` refuse on mismatch, so the title the human reads in the dialog is verified against the proposal. Set `"approvals": "command"` in the config to require typed commands for all of them. One caution comes with the convenience: prompts invite reflex clicks, and a reflex-clicked reset destroys a finished cycle, so read the prompt body before allowing. Assistants without permission prompts keep the typed flow.

Words need approval too, when `practices.messageApproval` is on (the default): the assistant writes the commit message with `unslopped propose commit`, the human reads it and runs `unslopped approve commit`, and `unslopped commit` executes exactly the approved text, hash-checked. `unslopped pr` writes its title and body to `.unslopped/proposals/pr.md` and refuses to post until `unslopped approve pr`; any new commit invalidates the approval by itself. The tool hook denies a raw assistant `git commit` while this is on.

Reviews and pull requests:

```
unslopped review [--file=review.md]                    record a review for the cycle
unslopped review --repo                                flag over-engineered lines across the repository
unslopped review --pr=<n> [--approve] [--no-post]      review a GitHub PR, post inline findings
unslopped pr [--draft]                                 push the branch, open the PR from the plan
unslopped pr status [--number=<n>]                     follow the PR; a merge moves the issue to done
```

Knowledge:

```
unslopped graph ["<words>"]              query the code map, or print it
unslopped graph node <file>              one file: symbols, rationale, imports, importers
unslopped graph path <from> <to>         shortest import chain between two files
unslopped graph why "<topic>"            design rationale and debt markers mined from comments
unslopped graph impact [--since=<ref>]   what the changes touch, who depends on it, test coverage
unslopped graph report | html | refresh  write .unslopped/GRAPH.md or .unslopped/graph.html, or rebuild
unslopped recall "<words>"               full-text search over cycles, plans, prompts, skills
```

Records:

```
unslopped skills | unslopped skill show|save|rm    learned playbooks with health tracking
unslopped debt ["<what>"]                    log a deviation instead of fixing it out of scope
unslopped decide ["<title>"]                 scaffold or list decision records in docs/decisions/
unslopped prefer "<statement>" [--project]   remember a preference across sessions
unslopped profile                            show remembered and detected preferences
```

Numbers:

```
unslopped metrics [--json]               lead time, deploy frequency, change failure rate, recovery
unslopped tokens [--json]                context spent vs saved by digests and dedupe
unslopped tracker [--issue=KEY]          tracker detection, credentials, issue lookup
```

Plumbing, called by hook systems rather than people:

```
unslopped install | unslopped uninstall [--only=...]
unslopped hook claude session|prompt|tool
unslopped hook cursor shell
```

Exit codes everywhere: 0 ok, 1 gate failed, 2 usage or state error.

## What the gates enforce

Each practice is a mechanical check, on by default unless noted, switchable under `practices` in `unslopped.config.json`, and part of the hashed config so it cannot be turned off mid-cycle.

| Practice | Check |
|---|---|
| Design before code | Goal, Approach and Files to touch must be filled before leaving plan; the protocol asks design questions first and records rejected options |
| Scope | every changed file must be listed in the plan; widening scope means editing the plan, visibly |
| Criteria quality | criteria must be observable outcomes; guarded work needs a rejection case; open questions block release |
| Red before green | `unslopped red` records the failing run; the test gate demands it when source and tests both changed |
| Test evidence and retention | source changes require test changes; deleting or gutting a test requires a written justification |
| Coverage floor | optional coverage command with a minimum percentage (istanbul, jest, pytest-cov, go, tarpaulin formats) |
| Small batches | the diff since cycle start stays under a line limit (400 by default) |
| Secrets | added lines are scanned for AWS, GitHub, GitLab, npm, PyPI, Slack, Stripe, SendGrid, Twilio, Telegram, Google, GCP, Azure, OpenAI, Anthropic and Linear credentials, private keys, JWTs, bearer tokens, connection strings, committed env files and high-entropy assignments; the same patterns redact tokens from every log the engine writes, refuse credentials in the config, and become critical findings in PR reviews |
| Style | no em or en dashes in added lines, no filler words in comments and prose, comment-heavy diffs fail, no issue ids in comments, one outcome per test name |
| Commit format | Conventional Commits, subjects under 72 characters, optional scope validation |
| Human authorship | the release gate fails when a commit since cycle start carries an assistant author, an assistant co-author trailer or a generated-with badge, and the tool hook denies such a commit before it runs; human co-authors pass (`practices.humanAuthorship`) |
| Message approval | no assistant-written commit message or PR text executes unread: propose, human approve, then execute exactly the approved text (`practices.messageApproval`) |
| Guarded paths | auth, security, permissions, migrations, payments, billing and ledger paths force a human review approval and a rejection criterion, whatever the diff size |
| Exclusive paths | a change to a shared boundary ships in its own cycle (off by default) |
| Changelog and declarations | a changelog present in the repo must change; configured declarations (`Indexes: none`) are demanded when matching paths change |
| Review artifact | `unslopped review` findings, counted by `[critical]` `[major]` `[minor]`; critical or stale reviews block release (off by default) |
| Rollback ready | a deploy command requires a rollback command |
| Handoff | a verification note for whoever tests it, posted to the issue on completion (off by default) |

## The code map

`unslopped` keeps a knowledge graph of the codebase in `.unslopped/graph.json`: files, symbols with line numbers, resolved import edges, which exported symbols each importer uses, and the design rationale mined from comments (`because`, `so that`, `workaround`, `must`, `never`, TODO markers) and doc sections (Why, Decision, Trade-offs). Extraction is local regex over 13 languages; nothing leaves the machine, no model is called.

It refreshes itself: the Claude Code hooks refresh it per prompt, `init` installs `post-commit`, `post-checkout` and `post-merge` git hooks, and `start` refreshes before planning. Refreshes are incremental by file mtime and size. The prompt hook injects the files relevant to each request, the plan gets a `## Relevant code` section, and the protocol directs the assistant to read the map before the repository. That is where the token savings come from: a dozen lines instead of a grep-and-read expedition. `.unslopped/GRAPH.md` and an interactive `.unslopped/graph.html` (canvas force layout, offline, no libraries) regenerate on every refresh that found changes.

## Memory

Every completed cycle is saved as a skill in `.unslopped/skills/`: files touched, criteria that passed, gate failures with their first error line, monitor notes. New cycles get matching skills listed in the plan and reuse them instead of rediscovering the work. Skills carry run counts and failure counts; underperformers are flagged at start and mechanically refreshed on reuse. Preferences (`unslopped prefer "no em dashes"`) live in `~/.unslopped/profile.md` across all projects, with repo conventions detected from git history. `unslopped recall` runs BM25 search over skills, archived cycles, gate failures, plans, past prompts and preferences.

## Trackers

Linear, Jira Cloud, GitHub Issues, or any HTTP endpoint through the webhook provider. Nothing to configure: the provider is detected from env vars, project files, the git remote and MCP configs; the issue is detected from the prompt or the branch name. The issue's title and description seed the plan, every phase change posts a comment and moves the issue through configured states, and credentials come from the environment only (or `gh auth` for GitHub). Tracker failures warn and never block a gate.

## Pull requests

`unslopped pr` pushes the branch and opens a PR written for the reviewer: a conventional title derived from the cycle's commits, then Why, What changed and Review focus (judgment calls from the plan, guarded paths touched, declaration lines), the issue linkage, the impact analysis and the cycle summary. `unslopped review --pr=<n>` reviews any PR, including ones opened by people: findings with `file:line` land as inline comments, critical findings request changes and fail CI, secrets in the diff are flagged without being asked, and changed hot exports without tests become major findings. `unslopped init --ci` makes that run on every PR through GitHub Actions. `unslopped pr status` follows the merge and closes the loop with the tracker.

Review also watches for lines that look exploitable: SQL built by hand, HTML sinks, shell commands from variables, unsafe deserialization, weak password hashing, guessable randomness for secrets, disabled certificate checks, and paths or redirects built from request data. Each one lands as an advisory finding that says in one sentence what an attacker could do with it. They never block a merge on their own; `practices.exploitScan` turns them off.

Review also enforces the two rungs of the leanness ladder a scanner can read: the standard library already does it, or it fits in one expression. A deep clone through `JSON.parse(JSON.stringify(x))`, a presence test built from `filter().length`, an `indexOf` compared to `-1`, `Object.assign` onto a fresh literal, a `catch` that only rethrows, a `forEach` that only pushes. Each becomes a minor finding naming what to write instead, so bloat is visible in every review without shutting the release gate. `unslopped review --repo` runs the same pass over the whole repository and records nothing. `practices.bloatScan` turns it off. The other five rungs need to know what the codebase and its dependencies already provide, so they stay the assistant's job with the code map, and the rung it names in the plan is a claim you check against the diff.

## Numbers

`unslopped metrics` computes delivery metrics from archived cycles with no external service: lead time, deployment frequency, change failure rate and recovery time (the DORA four), plus first-pass rates per gate and failures by phase, which show where the assistant keeps stumbling. `unslopped tokens` accounts for context: failing gate output is digested to the signal lines with the full log saved to disk, the protocol is never injected twice, and the report shows raw versus shown with estimated tokens.

## Configuration

`unslopped.config.json`, written by `init`, hashed per cycle:

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
    "exploitScan": true,
    "humanAuthorship": true,
    "messageApproval": true,
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
  },
  "approvals": "prompt",
  "posting": "auto"
}
```

`"posting": "draft"` stops the assistant writing anywhere other people read. The tracker comment and the status change go to `.unslopped/proposals/tracker.md` instead of the issue, `unslopped pr` writes the title and body to `.unslopped/proposals/pr.md` and opens nothing, and `unslopped review --pr` prints its findings and posts none. The branch is still pushed, because otherwise there is no pull request for you to open. You post the text; the tool never does.

It defaults to `"auto"`, which posts, because posting only happens when a tracker credential is configured and configuring one is the consent. Set `"draft"` when the assistant should draft and you should post.

Environment: `LINEAR_API_KEY`, `JIRA_EMAIL` + `JIRA_API_TOKEN` + `JIRA_BASE_URL`, `GITHUB_TOKEN` or `gh auth`, `UNSLOPPED_WEBHOOK_URL` + `UNSLOPPED_WEBHOOK_TOKEN`, `UNSLOPPED_GITHUB_API` for GitHub Enterprise, `UNSLOPPED_HOME` to relocate the global directory.

## Isolation and recovery

`unslopped start --worktree` runs the whole cycle in its own git worktree on a fresh branch, with `commands.setup` applied, leaving the main checkout untouched. `unslopped rollback` runs the configured undo, records it in the cycle history, and stays human-only.

One cycle is active per repository. Coming back to it, `unslopped resume` prints where it stands, the failing checks from the last gate run and the next actions. Walking away from it, `unslopped reset "<new goal>"` archives it as abandoned and starts the replacement in one command; `unslopped start` also warns when uncommitted files predate the cycle, so the baseline stays clean and the diff gates measure only the cycle's own work.

## Requirements

Node 18+ and git at runtime. No runtime dependencies. Written in TypeScript, shipped as compiled JavaScript; development needs Node 22.6+ (`npm run build`, `npm test`, `npm run typecheck`).

## License

MIT
