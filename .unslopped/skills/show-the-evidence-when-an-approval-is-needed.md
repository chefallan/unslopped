---
name: show-the-evidence-when-an-approval-is-needed
title: Show the evidence when an approval is needed
created: 2026-09-02T07:01:10.326Z
updated: 2026-09-02T07:01:10.326Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 0
lastCycle: 20260902-4b46ef
tags: show, evidence, approval, needed, src, test
---
# Show the evidence when an approval is needed

## When to use
Requests like:
- "Show the evidence when an approval is needed"

## Playbook
Files touched:
- AGENTS.md
- CLAUDE.md
- src/brief.ts
- src/cli.ts
- src/gates.ts
- src/protocol.ts
- src/resume.ts
- test/brief.test.ts

Acceptance criteria that passed:
- a deploy gate failing on missing approval prints the brief: cycle goal, criteria count, diff size, commit subjects, gate history, what approving unlocks, how to decline
- resume at the deploy phase shows the same brief
- approve deploy echoes the brief it just recorded
- the brief names the deploy command when one is configured and says the cycle completes and archives when none is
- the brief includes review finding counts when a review is on record
- the protocol tells assistants to relay the context block verbatim when asking for any human command
- the full test suite passes

Gate runs: 8 (0 failed)

## Known failures
- none recorded

## Notes
- The human approved deploy and then expected start to work; approval does not advance the phase and nothing says so. Logged as debt: approve should print what happens next.
- The start refusal message predates resume and still leads with reset; also logged. Both ride the sweep.
