---
name: approvals-name-what-they-approve
title: Approvals name what they approve
created: 2026-09-02T19:42:35.422Z
updated: 2026-09-02T19:42:35.422Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 1
lastCycle: 20260902-a4cc55
tags: approvals, name, they, approve, src, test
---
# Approvals name what they approve

## When to use
Requests like:
- "Approvals name what they approve"

## Playbook
Files touched:
- AGENTS.md
- CHANGELOG.md
- CLAUDE.md
- README.md
- src/cli.ts
- src/protocol.ts
- test/propose.test.ts

Acceptance criteria that passed:
- approve commit with a matching subject flag records the approval
- approve commit with a wrong subject refuses, shows the proposed title, and stores no approval
- approve deploy with a for flag naming the active cycle records the approval, and a wrong one refuses showing the cycle
- bare approve without flags still exits 0 and records the approval
- the protocol tells assistants to put the subject or cycle in the approve command they run
- the changelog carries an entry
- the full test suite passes

Gate runs: 9 (1 failed)

## Known failures
- plan gate, criteria quality failed 1 time(s): 1 criterion(s) are descriptions, not verifiable outcomes. state what can be observed (status code, value, visible effect):

## Notes
- Live tamper test passed: an allowed prompt with a wrong subject was refused with the real title printed, then the matching subject approved. The dialog now reads its own decision out loud.
- The deploy request named the cycle in the command line and verified against it.
- The criteria-quality gate rejected one vague criterion at plan time; the reworded observable version passed.
