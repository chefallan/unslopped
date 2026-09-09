---
name: adapt-the-ponytail-leanness-ladder-so-the-plan-names-the-run
title: Adapt the ponytail leanness ladder so the plan names the rung it used before any code is written
created: 2026-09-09T23:50:23.356Z
updated: 2026-09-09T23:50:23.356Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 1
lastCycle: 20260909-b4c7cd
tags: adapt, ponytail, leanness, ladder, plan, names, rung, used, src, test
---
# Adapt the ponytail leanness ladder so the plan names the rung it used before any code is written

## When to use
Requests like:
- "Adapt the ponytail leanness ladder so the plan names the rung it used before any code is written"

## Playbook
Files touched:
- AGENTS.md
- CHANGELOG.md
- CLAUDE.md
- package.json
- src/gates.ts
- src/practices.ts
- src/protocol.ts
- src/types.ts
- test/cli.test.ts
- test/helpers.ts
- test/ladder.test.ts

Acceptance criteria that passed:
- the plan gate fails when "## Approach" carries no rung marker, and the failure prints all seven rungs so the assistant can pick one
- the plan gate passes when "## Approach" carries a marker such as "Rung 2", in any letter case
- a rung number outside 1 to 7 fails the check rather than counting as a marker
- a rung marker written anywhere other than "## Approach" does not satisfy the check
- setting practices.ladder to false removes the check from the plan gate
- the generated AGENTS.md and CLAUDE.md both carry the seven rungs, the rule that the ladder runs after reading the code, and the four things it never cuts
- `npm test` exits 0

Gate runs: 9 (1 failed)

## Known failures
- deploy gate, approval failed 1 time(s): a human must run: unslopped approve deploy

## Notes
No gate failed on its first run this cycle, which is the first time that has happened. The lessons from
the previous cycle carried: reasons in parentheses under "## Files to touch", a bare "None" under
"## Open questions", one approved commit per artifact.

- Adding a default-on plan check broke twelve existing tests at once. That is what PRACTICES_OFF is for,
  and it now lists ladder alongside every other practice that defaults on. One test, the end to end cycle
  in test/cli.test.ts, runs on real defaults, so its plan fixture had to name a rung. That test is the
  only place the shipped default gets exercised, which makes it the one to check whenever a default moves.
- Writing regex and escape sequences through a python heredoc corrupted three files. `\b` arrived as a
  literal backspace byte, `\n` as a real newline. The typecheck caught two, and the third only showed
  as two passing tests failing. Escapes go through the editing tool, not through a shell heredoc. This
  cost four rounds and is the single biggest time sink of the cycle.
- prTitle picked chore again, for the same reason as last cycle: the plan commit outvoted the feature
  commit. Already logged as debt, and it happened on the very next cycle, so it is worth doing.

For next time: never put a regex or an escape sequence in a heredoc, and expect a default-on check to
need the shared test fixture updated in the same commit.
