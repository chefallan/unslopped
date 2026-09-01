---
name: keep-commits-authored-by-the-human-only
title: Keep commits authored by the human only
created: 2026-09-01T22:08:46.755Z
updated: 2026-09-01T22:08:46.755Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 0
lastCycle: 20260901-3b9ebc
tags: keep, commits, authored, human, src, test
---
# Keep commits authored by the human only

## When to use
Requests like:
- "Keep commits authored by the human only"

## Playbook
Files touched:
- AGENTS.md
- CLAUDE.md
- README.md
- src/gates.ts
- src/git.ts
- src/hooks.ts
- src/practices.ts
- src/protocol.ts
- src/types.ts
- test/authorship.test.ts
- test/helpers.ts

Acceptance criteria that passed:
- a commit whose message carries an assistant co-author trailer fails the release gate and the failure quotes the line
- a commit authored or committed by an assistant identity fails the release gate
- a "generated with" badge line in a commit body fails the release gate
- a human co-author trailer passes
- the tool hook denies a git commit command containing an assistant co-author trailer
- setting practices.humanAuthorship to false disables both the gate check and nothing else
- the full test suite passes

Gate runs: 8 (0 failed)

## Known failures
- none recorded

## Notes
- Clean cycle. One escape-quoting mishap while inserting commitMeta through a shell one-liner (backslashes collapsed into control bytes); rewriting through explicit char codes fixed it. Prefer the editor tools for source with regex literals.
- The assistant-identity pattern is shared between the gate and the hook on purpose; one list to maintain.
- Server-side coverage (pushes made without unslopped) stays open; branch protection plus a CI check is the complement if ever needed.
