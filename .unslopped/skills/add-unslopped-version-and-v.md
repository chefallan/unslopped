---
name: add-unslopped-version-and-v
title: Add unslopped --version and -v
created: 2026-09-03T21:39:52.416Z
updated: 2026-09-03T21:39:52.416Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 0
lastCycle: 20260903-8dcc7e
tags: add, unslopped, version, src, test
---
# Add unslopped --version and -v

## When to use
Requests like:
- "Add unslopped --version and -v"

## Playbook
Files touched:
- CHANGELOG.md
- package.json
- src/cli.ts
- test/version.test.ts

Acceptance criteria that passed:
- `unslopped --version` prints a semver line and exits 0
- `unslopped -v` prints the same version and exits 0
- `unslopped version` prints the same version and exits 0
- the printed version equals the version in package.json
- the full test suite passes

Gate runs: 8 (0 failed)

## Known failures
- none recorded

## Notes
- Both prompts popped on their own in the same turn, as the user now prefers. No manual reply between the brief and the prompt.
- The version reads from package.json next to the compiled module, so it never drifts from what is installed.
