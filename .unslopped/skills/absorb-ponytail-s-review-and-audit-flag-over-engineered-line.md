---
name: absorb-ponytail-s-review-and-audit-flag-over-engineered-line
title: Absorb ponytail's review and audit: flag over-engineered lines in the diff and across the repo
created: 2026-09-10T09:21:59.042Z
updated: 2026-09-10T09:21:59.042Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 1
lastCycle: 20260910-c3ca7f
tags: absorb, ponytail, review, audit, flag, over-engineered, lines, diff, src, test
---
# Absorb ponytail's review and audit: flag over-engineered lines in the diff and across the repo

## When to use
Requests like:
- "Absorb ponytail's review and audit: flag over-engineered lines in the diff and across the repo"

## Playbook
Files touched:
- AGENTS.md
- CHANGELOG.md
- CLAUDE.md
- README.md
- package.json
- src/cli.ts
- src/git.ts
- src/lean.ts
- src/practices.ts
- src/protocol.ts
- src/types.ts
- test/lean.test.ts

Acceptance criteria that passed:
- a deep clone written as JSON.parse(JSON.stringify(x)) is flagged, and the finding names structuredClone
- a presence test written as .filter(...).length > 0 is flagged, and the finding names some
- an indexOf compared against -1 is flagged, and the finding names includes
- a catch clause that only rethrows is flagged as removable
- Object.assign onto a fresh object literal is flagged, and the finding names the spread
- test files, lockfiles, minified files and markdown are skipped
- the scanner caps its findings, so one generated file cannot flood a review
- a line matching several patterns produces one finding, not several
- a forEach that appends to an accumulator is left alone, and so is a boolean comparison inside a larger condition
- the filter patterns stop at the closing paren, so a filter followed by a map that indexes is not flagged
- every bloat finding is minor, so it shows in the review without shutting the release gate
- `unslopped review` folds the diff findings into the artifact when practices.bloatScan is on
- practices.bloatScan set to false leaves the review artifact untouched
- `unslopped review --repo` prints findings from tracked files and records no review artifact
- `npm test` exits 0

Gate runs: 9 (1 failed)

## Known failures
- deploy gate, approval failed 1 time(s): a human must run: unslopped approve deploy

## Notes
No gate failed on a first run, the third cycle in a row. The whole value of this cycle came from one
step that no gate asks for.

- Running the scanner on this repository before shipping it found five hits, three of them false. Every
  test passed at that moment, and the release gate would have passed too. A pattern scanner cannot be
  tested into correctness by its own examples, because the examples are written by whoever wrote the
  pattern. Running it against code nobody wrote for it is the only real check. Do that for anything
  pattern-based before the release gate, not after.
- Two of the false positives were the same bug: a greedy `[^\n]*` inside a regex ran straight past the
  closing paren it was supposed to stop at. That class of error passes every positive test and only
  shows on code with more on the line.
- The third false positive was a design error, not a regex error. `flags.pr === true` is meaningful when
  the value is a string-or-boolean union, and the pattern could not know that. The fix narrowed it to
  the case where the whole condition is the comparison, which is the only form that is always pointless.
- One pattern was dropped rather than narrowed. `forEach` into `push` is ordinary accumulator code, and
  the rewrite belongs to neither rung this scanner claims. Its test was inverted rather than deleted, so
  the reasoning survives and nobody re-adds it from the changelog.
- Version 0.1.7, skipping 0.1.6, because PR #3 is open and already claims it. Two open pull requests both
  inserting under the same changelog heading will conflict there whatever the numbers are.

For next time: for any pattern-based check, run it on real code the patterns were not written from
before ticking a single criterion.
