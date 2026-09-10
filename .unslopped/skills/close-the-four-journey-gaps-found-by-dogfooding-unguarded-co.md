---
name: close-the-four-journey-gaps-found-by-dogfooding-unguarded-co
title: Close the four journey gaps found by dogfooding: unguarded commits after a cycle, the quiz score shown before any attempt, log refusing without a cycle, and the stale README journey
created: 2026-09-10T06:45:29.191Z
updated: 2026-09-10T06:45:29.191Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 1
lastCycle: 20260910-0298d5
tags: close, four, journey, gaps, found, dogfooding, unguarded, commits, src, test
---
# Close the four journey gaps found by dogfooding: unguarded commits after a cycle, the quiz score shown before any attempt, log refusing without a cycle, and the stale README journey

## When to use
Requests like:
- "Close the four journey gaps found by dogfooding: unguarded commits after a cycle, the quiz score shown before any attempt, log refusing without a cycle, and the stale README journey"

## Playbook
Files touched:
- AGENTS.md
- CHANGELOG.md
- CLAUDE.md
- README.md
- package.json
- src/cli.ts
- src/git.ts
- src/hooks.ts
- src/practices.ts
- src/protocol.ts
- test/journey.test.ts

Acceptance criteria that passed:
- with no cycle active, a git commit staging only files under .unslopped/ is allowed through the hook
- with no cycle active, a git commit staging a source file is refused, and the refusal names the file and says to start a cycle
- with a cycle active, a git commit is still refused with the propose and approve instruction, unchanged
- with no cycle active, `git commit -a` is refused for a tracked source change it would sweep in, since nothing is staged when the hook decides
- `git commit --amend` is not mistaken for `--all`, and `git commit -a` over only bookkeeping is still allowed
- quizCheck reports a recorded quiz with no attempt yet as waiting for an answer, and never prints a score for it
- quizCheck still reports the score and the missed questions once an attempt exists
- `unslopped log` with no active cycle prints the archived cycles instead of exiting with an error
- `unslopped log` with an active cycle still prints that cycle's gate runs
- the README journey names the ladder rung as part of the assistant's step and the quiz as a human moment
- the README states the same number of human moments that the journey steps actually contain
- `npm test` exits 0

Gate runs: 9 (1 failed)

## Known failures
- deploy gate, approval failed 1 time(s): a human must run: unslopped approve deploy

## Notes
No gate failed on a first run, the second cycle in a row. Two real mistakes happened outside the gates,
which is where the remaining risk lives.

- Writing the handoff caught a bypass in the fix itself. `git commit -a` stages after the hook decides,
  so the first version of the guard would have waved it through, and no criterion would have noticed.
  The habit that caught it was writing down how a person would try to break the thing, not writing more
  tests. Worth doing before the release gate, not after.
- This cycle started on the previous cycle's branch instead of a fresh one, because `start` only refuses
  protected branches and `feat/leanness-ladder` was not protected. It turned out harmless only because
  that branch had already merged. Had it not, these commits would have landed inside someone else's open
  pull request, and the fix would have needed a force push, which is denied. `start` could warn when the
  current branch already has an open pull request.
- The classifier denied two shell commands this cycle: a `gh pr merge` and one heredoc that wrote files.
  Neither was worked around. The heredoc denial pushed plan and code edits onto the editing tools, which
  is also the fix for the escape corruption logged last cycle, so the constraint helped.
- Ticking twelve criteria took a second pass. Criterion nine claimed the README states the real number of
  human moments, and the first test only checked that the wrong number was gone. Counting the moments by
  hand gave six or seven, so the README and the test both changed before the tick was honest.

For next time: write the handoff before the release gate, since it is the step that finds bypasses, and
check what branch `start` is about to run on.
