---
name: require-human-approval-of-commit-and-pr-text
title: Require human approval of commit and PR text
created: 2026-09-02T03:58:56.318Z
updated: 2026-09-02T03:58:56.318Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 2
lastCycle: 20260901-8c3c78
tags: require, human, approval, commit, pr, text, src, test
---
# Require human approval of commit and PR text

## When to use
Requests like:
- "Require human approval of commit and PR text"

## Playbook
Files touched:
- AGENTS.md
- CLAUDE.md
- README.md
- src/cli.ts
- src/config.ts
- src/hooks.ts
- src/pr.ts
- src/practices.ts
- src/protocol.ts
- src/resume.ts
- src/state.ts
- src/types.ts
- test/authorship.test.ts
- test/cli-pr.test.ts
- test/helpers.ts
- test/propose.test.ts

Acceptance criteria that passed:
- `unslopped commit` with no proposal on file refuses and names the propose command
- `unslopped commit` with a proposal but no approval refuses and names the approve command
- after `approve commit`, `unslopped commit` creates the commit with exactly the proposed subject and body, then consumes the approval
- editing the proposal after approval makes `unslopped commit` refuse until the human approves again
- with messageApproval on, the tool hook denies a raw assistant `git commit`
- with messageApproval on, `unslopped pr` writes the title and body as a proposal and refuses to post until `approve pr`
- setting practices.messageApproval to false restores the old flow untouched
- the full test suite passes

Gate runs: 10 (2 failed)

## Known failures
- code gate, scope failed 1 time(s): 3 changed file(s) are not in the plan's "## Files to touch":
- deploy gate, approval failed 1 time(s): a human must run: unslopped approve deploy

## Notes
- The two deploy failures were the approval gate holding while the human weighed it, which surfaced the real product gap: approval requests carry no evidence. The briefs cycle queued from this is the fix.
- The scope catch mid-cycle (three undeclared files) keeps proving the plan-change flow works under pressure.
- From the next cycle on, release commits go through propose and approve; this cycle's commit was the last one an assistant made here unreviewed.
