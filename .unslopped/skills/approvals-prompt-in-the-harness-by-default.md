---
name: approvals-prompt-in-the-harness-by-default
title: Approvals prompt in the harness by default
created: 2026-09-02T19:08:01.825Z
updated: 2026-09-02T19:08:01.825Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 4
lastCycle: 20260902-d767ec
tags: approvals, prompt, harness, default, src, test
---
# Approvals prompt in the harness by default

## When to use
Requests like:
- "Approvals prompt in the harness by default"

## Playbook
Files touched:
- AGENTS.md
- CHANGELOG.md
- CLAUDE.md
- README.md
- src/brief.ts
- src/cli.ts
- src/config.ts
- src/detect.ts
- src/hooks.ts
- src/protocol.ts
- src/types.ts
- test/cli-hooks.test.ts
- test/helpers.ts
- test/hooks.test.ts
- test/oneclick.test.ts
- test/practices.test.ts
- test/sweep.test.ts
- test/upgrade.test.ts

Acceptance criteria that passed:
- an approve command under prompt mode returns ask, with the proposal text in the reason for commit and the brief evidence for deploy
- the claude tool hook prints permissionDecision ask JSON and exits 0 for an ask verdict, and keeps exit 2 for denials
- the cursor hook answers permission ask for the same case
- reset and rollback raise the prompt with their consequences under prompt mode, and stay denied under command mode
- approvals set to command restores the deny behavior for approve
- the protocol tells assistants without permission prompts that they are not hooked and must not run approve
- unslopped proposals prints each pending proposal with its text and its state
- the changelog carries an entry for this change
- the full test suite passes

Gate runs: 12 (4 failed)

## Known failures
- release gate, clean tree failed 4 time(s): uncommitted changes:
- release gate, commits failed 3 time(s): no commits since cycle start
- release gate, criteria verified failed 3 time(s): 1 acceptance criterion(s) not ticked [x] in the plan. verify each one, then tick it:

## Notes
- The deploy approval of this very cycle was the feature's first live run: hook answered ask, the harness prompted, the human clicked allow, the command executed. No typed command.
- The mid-cycle global upgrade produced zero drift, which is the config-text fix from the sweep proving itself.
- Release failures caught a real design gap: proposal files were committed with the feature and their consumption dirtied the tree. Proposals belong in .gitignore; logged as debt after completion along with two hook precision gaps (force-push rule unanchored, commit rule matching the filename commit.md).
