---
name: debt-sweep-all-7-item-s
title: Debt sweep, all: 7 item(s)
created: 2026-09-02T09:57:46.831Z
updated: 2026-09-02T09:57:46.831Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 0
lastCycle: 20260902-0ba199
tags: debt, sweep, item, src, test
---
# Debt sweep, all: 7 item(s)

## When to use
Requests like:
- "Debt sweep, all: 7 item(s)"

## Playbook
Files touched:
- CHANGELOG.md
- src/cli.ts
- src/config.ts
- src/hooks.ts
- src/practices.ts
- src/status.ts
- src/types.ts
- test/sweep.test.ts

Acceptance criteria that passed:
- a heredoc whose body names a human-only command passes the tool hook while the same command at command position stays blocked
- a command that only mentions the config filename away from a redirect target or writer argument passes; a redirect into the file or a writer taking it as an argument stays blocked
- CHANGELOG.md exists with a 0.1.0 section and the release gate enforces updating it this cycle
- a Files to touch entry with a trailing parenthetical note still covers its file in the scope check
- a cycle whose stored config text matches the file reports no drift even when the merged-defaults hash differs, and a real edit prints the changed lines
- the start refusal names resume before reset
- approving deploy, config or review prints the next action to run
- the full test suite passes

Gate runs: 8 (0 failed)

## Known failures
- none recorded

## Notes
- Clean sweep, zero gate failures. Every fixed item came from real usage this week, which says the debt loop works: log in one line, sweep in one cycle.
- The hook false-positived on plan prose one final time during its own fix, a fitting send-off.
- Next friction to remove is the approval keystroke itself; the one-click cycle follows immediately.
