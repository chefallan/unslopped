---
name: adapt-i-have-adhd-give-the-assistant-a-report-contract-and-c
title: Adapt i-have-adhd: give the assistant a report contract and cap the grouped lists unslopped prints
created: 2026-09-10T09:49:36.966Z
updated: 2026-09-10T09:49:36.966Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 2
lastCycle: 20260910-9c2581
tags: adapt, i-have-adhd, give, assistant, report, contract, cap, grouped, src, test
---
# Adapt i-have-adhd: give the assistant a report contract and cap the grouped lists unslopped prints

## When to use
Requests like:
- "Adapt i-have-adhd: give the assistant a report contract and cap the grouped lists unslopped prints"

## Playbook
Files touched:
- AGENTS.md
- CHANGELOG.md
- CLAUDE.md
- README.md
- package.json
- src/cli.ts
- src/protocol.ts
- test/report.test.ts

Acceptance criteria that passed:
- the generated AGENTS.md and CLAUDE.md both carry a report section naming the next action first, one concrete next step last, and no preamble or recap
- the report section tells the assistant to rank and group a long list at five items per group
- the report section credits i-have-adhd as the source
- the old one-line reporting rule is gone, so the instruction exists in one place
- `unslopped debt` prints at most five rows in a category and then a line counting the rest
- `unslopped debt` prints every row when a category holds five or fewer, with no count line
- a category with no rows is still left out of the listing entirely
- `npm test` exits 0

Gate runs: 10 (2 failed)

## Known failures
- code gate, style failed 1 time(s): 2 style problem(s) in the diff. write precisely and directly:
- deploy gate, approval failed 1 time(s): a human must run: unslopped approve deploy

## Notes
One gate failure, and it was the best moment of the cycle: the style gate rejected the word "just" in
the report contract itself. A rule about writing plainly, caught by the check that enforces writing
plainly, before it reached a single reader. That is the tool working on its own instructions.

- Six of the ten source rules were already satisfied. Reading each one against what the tool does before
  writing anything cut the work by more than half. The temptation with a rules list is to adopt all ten
  as text and call it absorbed, which would have added six paragraphs of duplication and made the
  instruction file worse.
- One rule was refused rather than adopted. Time estimates mean guessing, and every other number this
  tool prints is measured. Adopting it would have put the one unverifiable number in a report whose whole
  point is that its numbers are real.
- Three cycles are now open as pull requests at 0.1.6, 0.1.7 and 0.1.8, each inserting a changelog
  section under the same heading. Every one after the first merge has one conflict hunk. Stacking four
  cycles in a day without merging is the cause, and it is a queue problem rather than a code problem.
- The review's third finding is the honest limit of this cycle: nothing verifies the contract, so its
  value rests on an assistant following instructions it can ignore with no gate noticing. That is true of
  the ladder's rungs too. Prompt-level rules are the tool's weakest kind of lever, and worth using only
  where a mechanical check is genuinely impossible.

For next time: read a rules list against what already exists before writing any of it down, and merge
the queue before starting a fifth cycle.
