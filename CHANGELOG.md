# Changelog

## 0.1.0 (unreleased)

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

### Second sweep
- The approve prompt always shows the pending text or says nothing is pending, with or without an active cycle.
- The proposals directory is gitignored; consuming a proposal no longer dirties the release tree.
- The force-push rule matches at command position only, and the commit rule requires commit as the git subcommand, so the filename commit.md no longer trips it.

### In this sweep
- The tool hook reads commands like a shell: heredoc bodies ignored, command names matched at command position, the config rule limited to real writes.
- Config upgrades no longer read as mid-cycle tampering; drift shows the changed lines.
- Files-to-touch entries may carry parenthetical notes.
- The start refusal points at resume before reset, and approvals print the next action.
