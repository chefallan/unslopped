---
name: protocol-tells-hooked-assistants-to-run-approve-not-delegate
title: Protocol tells hooked assistants to run approve, not delegate it
created: 2026-09-03T06:31:58.823Z
updated: 2026-09-03T06:31:58.823Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 0
lastCycle: 20260903-07b09c
tags: protocol, tells, hooked, assistants, run, approve, delegate, src, test
---
# Protocol tells hooked assistants to run approve, not delegate it

## When to use
Requests like:
- "Protocol tells hooked assistants to run approve, not delegate it"

## Playbook
Files touched:
- AGENTS.md
- CHANGELOG.md
- CLAUDE.md
- package.json
- src/protocol.ts
- test/ritual.test.ts

Acceptance criteria that passed:
- the deploy row does not contain "tell the human to run" or "Never run approve yourself"
- the deploy row tells the assistant to run approve deploy so the prompt reaches the human on a hooked assistant
- the release row tells the assistant to run approve commit rather than ask the human to run it
- protocolBody carries no phase row that forbids the assistant from running approve
- package.json version is 0.1.1
- the changelog carries a 0.1.1 entry for the fix
- the full test suite passes

Gate runs: 8 (0 failed)

## Known failures
- none recorded

## Notes
- A real user hit this in a second project: the assistant read the deploy row and told the human to type approve deploy. The one-click rule and the phase rows disagreed, and the rows won.
- Lesson: when a behavior changes, update the phase table, not only the rules list. Assistants follow the row for the phase they are in.
- The fix ships in 0.1.1 and reaches other projects only after a republish and a global update, because the hook injects the protocol from the installed binary.
