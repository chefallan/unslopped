---
name: make-pr-review-comments-plain-and-short
title: Make PR review comments plain and short
created: 2026-09-01T19:40:38.062Z
updated: 2026-09-01T19:40:38.062Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 3
lastCycle: 20260901-9e69e9
tags: make, pr, review, comments, plain, short, src, test
---
# Make PR review comments plain and short

## When to use
Requests like:
- "Make PR review comments plain and short"

## Playbook
Files touched:
- AGENTS.md
- CLAUDE.md
- src/github.ts
- src/impact.ts
- src/pr.ts
- src/protocol.ts
- test/cli-pr.test.ts
- test/github.test.ts
- test/impact.test.ts
- unslopped.config.json

Acceptance criteria that passed:
- inline review comments start with "Must fix", "Worth fixing" or "Minor" and never with the bare severity words
- the review summary states the counts as a sentence and prints "Nothing to flag. Looks good." when there are no findings
- the automatic secret finding is one sentence telling the author to remove the value, load it from the environment and rotate it
- the automatic impact finding names the symbol, says how many files depend on it and asks for a test, without the words hot, export or covering
- the protocol release row asks reviewers for one short plain sentence per finding
- the full test suite passes

Gate runs: 11 (3 failed)

## Known failures
- code gate, scope failed 3 time(s): 2 changed file(s) are not in the plan's "## Files to touch":

## Notes
- One code gate failure, and it was the scope check doing its job twice over: an undeclared test file I edited, and the user's uncommitted config restore riding in the diff. Declared the first, committed the second as its own chore.
- The config-filename-plus-redirect hook false positive fired again mid-cycle; it is the top debt entry and should be the next sweep.
- Voice changes live only in the rendering layer; keeping the artifact format untouched meant zero parser or CI changes.
