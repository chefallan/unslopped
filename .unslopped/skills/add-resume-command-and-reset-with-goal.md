---
name: add-resume-command-and-reset-with-goal
title: Add resume command and reset with goal
created: 2026-09-01T19:17:20.422Z
updated: 2026-09-01T19:17:20.422Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 1
lastCycle: 20260831-08ed52
tags: add, resume, command, reset, goal, src, test
---
# Add resume command and reset with goal

## When to use
Requests like:
- "Add resume command and reset with goal"

## Playbook
Files touched:
- AGENTS.md
- CLAUDE.md
- README.md
- src/cli.ts
- src/hooks.ts
- src/practices.ts
- src/protocol.ts
- src/resume.ts
- test/resume.test.ts

Acceptance criteria that passed:
- `ade resume` with no active cycle exits 2 and its message names `ade start`
- `ade resume` during an active cycle prints the phase line, the plan path and a numbered "do next" list
- `ade resume` after a failed gate run lists the failing check names from that run
- `ade continue` prints the same output as `ade resume`
- `ade reset "<goal>"` archives the active cycle as abandoned and starts a new cycle with that goal in one invocation
- `ade start` on a tree with uncommitted files that predate the cycle prints a baseline warning naming the file count
- scanStyle returns no hits for forbidden characters on lines whose file is ade.config.json

Gate runs: 9 (1 failed)

## Known failures
- deploy gate, approval failed 1 time(s): a human must run: ade approve deploy

## Notes
- The only gate failures this cycle were two deploy runs before the human approval landed; the gate held both times, which is the designed behavior, not a defect.
- Dogfooding surfaced two PreToolUse false positives (hook regexes match command names and the config filename inside file content written through shell heredocs); both are in the debt log with src/hooks.ts as the location.
- Plan "Files to touch" entries must be bare paths; parenthetical notes on the same line break scopeCheck matching. Logged as a pattern candidate for scopeCheck tolerance.
- The baseline lesson repeated: the whole tree was untracked at start and needed its own chore commit first, which is exactly what the new start warning now catches.
