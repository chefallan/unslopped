---
name: install-allowlists-the-safe-cycle-commands-so-auto-mode-does
title: Install allowlists the safe cycle commands so auto mode does not block them
created: 2026-09-03T08:04:50.292Z
updated: 2026-09-03T08:04:50.292Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 0
lastCycle: 20260903-955904
tags: install, allowlists, safe, cycle, commands, auto, mode, block, src, test
---
# Install allowlists the safe cycle commands so auto mode does not block them

## When to use
Requests like:
- "Install allowlists the safe cycle commands so auto mode does not block them"

## Playbook
Files touched:
- CHANGELOG.md
- README.md
- package.json
- src/install.ts
- test/install.test.ts

Acceptance criteria that passed:
- mergeClaudeSettings adds Bash allow rules for commit, next, red, propose and start in bare and npx forms
- mergeClaudeSettings does not add any rule for approve, reset or rollback
- mergeClaudeSettings preserves existing allow entries and does not duplicate on a second run
- stripClaudeSettings removes exactly the rules install added and leaves other allow entries intact
- package.json version is 0.1.2
- the README and changelog explain the allowlist and why approve stays off it
- the full test suite passes

Gate runs: 8 (0 failed)

## Known failures
- none recorded

## Notes
- The user wanted the approval prompt to pop automatically in the same turn, not after a manual reply. Preference updated: show the brief, then run approve in the same turn so the dialog appears on its own.
- This cycle fixed the auto mode classifier blocking the mechanical commands. Publishing 0.1.2 and reinstalling closes the loop in every project.
