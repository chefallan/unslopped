---
name: put-the-user-journey-in-the-readme-and-help
title: Put the user journey in the README and help
created: 2026-09-02T04:14:01.774Z
updated: 2026-09-02T04:14:01.774Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 0
lastCycle: 20260902-6150d9
tags: put, user, journey, readme, help, src, test
---
# Put the user journey in the README and help

## When to use
Requests like:
- "Put the user journey in the README and help"

## Playbook
Files touched:
- README.md
- src/cli.ts
- test/help.test.ts

Acceptance criteria that passed:
- `unslopped -h` exits 0 and prints the same text as `unslopped help`
- the help output states the loop and the five human moments before the command list
- the README opening is the approved paragraph ending "It has to earn it."
- the README carries a journey section that names who acts at each step and lists the five human moments
- the full test suite passes

Gate runs: 8 (0 failed)

## Known failures
- none recorded

## Notes
- First cycle whose release commit went through propose and approve; the flow held with zero friction beyond the intended pause.
- The journey now lives in three places on purpose: the artifact for sharing, the README for depth, help for the terminal glance. Same five moments in all three.
