# Changelog

## 0.1.7

### Added
- The other half of ponytail: a leanness scanner. `unslopped review` now adds its own minor findings for lines the ladder would have skipped, where the standard library or one expression already does the job. A deep clone through `JSON.parse(JSON.stringify(x))`, a presence test built from `filter().length`, taking `filter()[0]` instead of `find()`, an `indexOf` compared to `-1`, `Object.assign` onto a fresh literal, a `catch` that only rethrows, values rebuilt from `Object.keys().map()`, a `new Promise` around `setTimeout`. Each finding names what to write instead. They are minor on purpose, so bloat shows in every review without shutting the release gate.
- `unslopped review --repo` runs the same pass over every tracked file instead of the diff, and records no review artifact. `practices.bloatScan` turns both off.

The scanner enforces the two rungs a line can carry: the standard library does it, or it fits in one expression. The other five need to know what the codebase and its dependencies already provide, so they stay the assistant's judgment, recorded as the rung in the plan and checked by a human against the diff.
## 0.1.6

### Fixed
- The commit guard stopped at the end of a cycle. `messageApproval` only blocked an assistant's `git commit` while a cycle was active, so once the monitor gate completed one, any commit went through unreviewed, source included. With no cycle active the hook now allows a commit only when every staged path sits under `.unslopped/`, which keeps the archive and debt-log commits working and refuses everything else by naming the files and pointing at `unslopped start`. `git commit -a` stages after the hook decides, so when the command carries `-a` or `--all` the guard also reads the tracked modifications the commit would sweep in; `--amend` is not treated as `--all`. The pre-cycle chore commit of files that predate a cycle is now the human's, and the protocol says so.
- The quiz gate reported a score before anyone had answered. A quiz recorded by `unslopped quiz --file=` starts with no attempt, and the deploy gate read that as zero correct with every question missed. It now says the questions are waiting for an answer, and only reports a score once an attempt exists.
- `unslopped log` exited with an error when no cycle was active, which is when its history is most useful. It now lists the archived cycles with their gate runs and failures, and says `no cycles yet` in a repository that has never run one.

### Changed
- The README journey was written before the leanness ladder and the quiz. It now names the rung the assistant has to record, the quiz as a human moment when it is enabled, and the real number of approval prompts in a cycle rather than five.

## 0.1.5

### Added
- A leanness ladder in the plan phase, adapted from ponytail (github.com/DietrichGebert/ponytail). The generated assistant instructions carry seven rungs, from "does this need to exist" down to "the minimum that works", the rule that the ladder runs after reading the code the change touches, and the four things it never cuts: trust-boundary validation, data loss handling, security and accessibility. The plan gate refuses an approach that names no rung, so the assistant records where it stopped, as "Rung 2" plus one sentence.

### Changed
- `practices.ladder` defaults to true, which every other plan quality check here already does. An existing project's next plan gate fails until its approach names a rung; the failure prints all seven so the fix is one line. Set `practices.ladder` to false to keep the old behaviour.

## 0.1.4

### Added
- A comprehension gate for the human who accepts a change. The assistant writes multiple choice questions from the diff, `unslopped quiz --file=<quiz.md>` records them and prints them without the answer key, and `unslopped quiz --answer=<letters>` grades them. The deploy gate stays shut until the answers are right, and reopens for a new quiz once a later commit changes the code. Off by default: set `practices.quiz.enabled` to true, with `minLines` to skip small diffs, `pass` for the mark and `maxAttempts` for the retry cap.

## 0.1.3

### Added
- `unslopped --version`, `unslopped -v` and `unslopped version` print the installed version, read from the package so it always matches what is running.

## 0.1.2

### Fixed
- Claude Code's auto mode classifier blocked the mechanical cycle commands (`commit`, `next`, `red`, `propose`, `start`), so the assistant kept stopping to ask the human to run them by hand. `unslopped install` now writes permission allowlist rules for those commands, in the bare and npx forms, so the loop runs without interruption. It does not allowlist `approve`, `reset` or `rollback`; those must keep raising the prompt, which is the human decision. `unslopped uninstall` removes exactly the rules install added.

## 0.1.1

### Fixed
- The deploy and release phase rows told the assistant to make the human type the approve command, which contradicted the one-click rule and defeated the prompt. The rows now tell a hooked assistant to run the approve command itself, so the harness raises the allow-or-deny prompt, and to ask the human only when the platform has no prompts.

## 0.1.0

### Publish pass
- The README documents the propose flow, the proposals command, the approvals option and the dialog-title chat-body reading order; the configuration sample matches the shipped defaults.

The first release, born as ade and renamed to unslopped before publish.

### The engine
- Eight gated phases (plan, code, build, test, release, deploy, operate, monitor), one active cycle per repository, advancement only on real commands and exit codes.
- Practices as mechanical checks: plan sections, criteria quality, scope, red before green, test evidence, tests kept, diff cap, secret scan, style, commit format, changelog, protected branches, guarded paths, human authorship, message approval.
- Config hashed per cycle; mid-cycle edits block every gate until a human approves. Drift compares the stored config text and prints the changed lines.

### Humans decide
- approve deploy, config, review, commit and pr are human-only; hooks deny them to assistants before they run.
- Commit messages and PR text go through propose, approve, execute, hash-checked end to end.
- Deploy approval requests carry an evidence brief: criteria, tests, diff, commits, gate history, what approving unlocks, how to decline.
- Every commit is authored by the human: assistant authors, co-author trailers and generated-with badges fail the release gate and are denied at the hook.

### Reviews
- PR reviews post plain-language findings inline: Must fix, Worth fixing, Minor. Clean reviews say so.
- The review adds its own findings: leaked credentials, exploitable-looking lines with a one-sentence attack story, risky changes with no covering test.

### Around the loop
- resume says where the cycle stands and what to do next; reset with a goal abandons and restarts in one step; start warns about dirty baselines.
- Trackers detected and updated automatically (Linear, Jira, GitHub, webhook); PRs opened from the plan with impact analysis.
- Memory: every completed cycle becomes a skill, debt is logged and swept by seeded cycles, preferences follow the user, metrics come from the archive.
- Code map with symbols, imports and mined rationale keeps assistant token use low.

### One-click decisions
- On hooked assistants (Claude Code, Cursor) the human commands raise a native allow-or-deny prompt with the evidence attached: approvals carry the deploy brief, the proposed commit message or the PR text; reset carries what would be abandoned; rollback carries the command it runs. Default; `"approvals": "command"` restores typed commands for all of them. A proposals command shows pending text without opening files.

### Named approvals
- The protocol requires the show-then-prompt ritual: the full text ends the assistant's message, and the prompt opens the next turn, so the words are on screen when the dialog is.
- Approve requests carry the decision in the command line the dialog shows: commit and pr take a verified subject, deploy takes a verified cycle reference, and mismatches refuse. Assistants must show the full text before raising the prompt.

### Second sweep
- The approve prompt always shows the pending text or says nothing is pending, with or without an active cycle.
- The proposals directory is gitignored; consuming a proposal no longer dirties the release tree.
- The force-push rule matches at command position only, and the commit rule requires commit as the git subcommand, so the filename commit.md no longer trips it.

### In this sweep
- The tool hook reads commands like a shell: heredoc bodies ignored, command names matched at command position, the config rule limited to real writes.
- Config upgrades no longer read as mid-cycle tampering; drift shows the changed lines.
- Files-to-touch entries may carry parenthetical notes.
- The start refusal points at resume before reset, and approvals print the next action.
