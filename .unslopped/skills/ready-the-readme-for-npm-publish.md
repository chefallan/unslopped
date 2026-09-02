---
name: ready-the-readme-for-npm-publish
title: Ready the README for npm publish
created: 2026-09-02T21:42:42.091Z
updated: 2026-09-02T21:42:42.091Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 0
lastCycle: 20260902-bc000f
tags: ready, readme, npm, publish
---
# Ready the README for npm publish

## When to use
Requests like:
- "Ready the README for npm publish"

## Playbook
Files touched:
- CHANGELOG.md
- README.md

Acceptance criteria that passed:
- the README Commands section lists propose commit, commit and proposals with one-line explanations
- the configuration sample contains approvals set to prompt plus exploitScan, humanAuthorship and messageApproval
- the journey states that the dialog shows the verified title and the chat shows the body
- the paragraph under the cycle table says human commands raise a prompt and mismatches refuse
- the changelog carries a line for the documentation pass
- the full test suite passes

Gate runs: 8 (0 failed)

## Known failures
- none recorded

## Notes
- The prompt only appears when the approve command actually runs; a read-only resume between the brief and the prompt made the human expect a dialog that was never invoked. The tempo is: brief ends the turn, the human replies, the approve command is the first action of the next turn.
