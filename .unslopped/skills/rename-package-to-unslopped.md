---
name: rename-package-to-unslopped
title: Rename package to unslopped
created: 2026-09-01T19:27:35.353Z
updated: 2026-09-01T19:27:35.353Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 0
lastCycle: 20260901-8c66a4
tags: rename, package, unslopped, bin, src, test
---
# Rename package to unslopped

## When to use
Requests like:
- "Rename package to unslopped"

## Playbook
Files touched:
- AGENTS.md
- CLAUDE.md
- README.md
- bin/unslopped.js
- package-lock.json
- package.json
- src/cli.ts
- src/config.ts
- src/detect.ts
- src/gates.ts
- src/git.ts
- src/github.ts
- src/graph.ts
- src/hooks.ts
- src/impact.ts
- src/init.ts
- src/install.ts
- src/loop.ts
- src/memory.ts
- src/pr.ts
- src/practices.ts
- src/protocol.ts
- src/resume.ts
- src/state.ts
- src/status.ts
- src/tracker.ts
- test/borrowed.test.ts
- test/cli-hooks.test.ts
- test/cli-memory.test.ts
- test/cli-pr.test.ts
- test/cli-tracker.test.ts
- test/cli.test.ts
- test/decide.test.ts
- test/detect.test.ts
- test/github.test.ts
- test/graph.test.ts
- test/helpers.ts
- test/hooks.test.ts
- test/impact.test.ts
- test/init.test.ts
- test/install.test.ts
- test/loop.test.ts
- test/memory.test.ts
- test/practices.test.ts
- test/resume.test.ts
- test/rigor.test.ts
- test/style-secrets.test.ts
- test/tokens.test.ts
- test/tracker.test.ts
- test/upgrade.test.ts

Acceptance criteria that passed:
- `node bin/unslopped.js help` prints usage starting with `unslopped <command>` and no output anywhere in src or test mentions the old names outside legacy-compat patterns
- package.json name is unslopped and its only binary is `unslopped` pointing at bin/unslopped.js
- the full test suite passes and tsc emits no errors after the sweep
- init applied to a file carrying the legacy start and end markers replaces that block in place, leaving exactly one protocol block
- install onto Claude settings containing legacy hook commands replaces them, leaving exactly one hook entry per event
- the tool hook still blocks the legacy command names for approve, reset and rollback and still blocks writes to the legacy config filename during an active cycle
- the style gate scan of this cycle's diff reports zero hits, with the fixture line in test/style-secrets.test.ts building its dash from a char code

Gate runs: 8 (0 failed)

## Known failures
- none recorded

## Notes
- Zero gate failures this cycle; the dry run on a clone caught both problems before they could fail a gate (regex literals glue letters onto escape sequences, and a changed fixture line re-enters the style scan).
- Running the gates with the old binary while renaming the tool underneath it worked because state, config and .gitignore stayed old-named; that sequencing is the reusable playbook for renaming self-hosted tooling.
- The legacy-compat surface (markers, hook detection, blocked command names, config filename) is what makes the upgrade one command per machine instead of a manual cleanup.
