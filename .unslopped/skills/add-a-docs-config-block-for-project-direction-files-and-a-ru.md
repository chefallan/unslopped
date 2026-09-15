---
name: add-a-docs-config-block-for-project-direction-files-and-a-ru
title: Add a docs config block for project direction files and a rule for when two of them disagree
created: 2026-09-14T14:11:57.788Z
updated: 2026-09-14T14:11:57.788Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 1
lastCycle: 20260914-04cfd2
tags: add, docs, config, block, project, direction, files, rule, src, test
---
# Add a docs config block for project direction files and a rule for when two of them disagree

## When to use
Requests like:
- "Add a docs config block for project direction files and a rule for when two of them disagree"

## Playbook
Files touched:
- AGENTS.md
- CHANGELOG.md
- CLAUDE.md
- README.md
- package.json
- src/config.ts
- src/gates.ts
- src/hooks.ts
- src/practices.ts
- src/protocol.ts
- src/types.ts
- test/docs.test.ts

Acceptance criteria that passed:
- a docs entry pointing at a file that is not on disk fails the plan gate, and the failure names the entry and the path
- a docs entry pointing at a file that exists passes, and the check reports how many were found
- docs defaults to an empty list, so a project without the key gains no check
- the session context lists each configured doc with its name and path
- the session context lists no docs when none are configured, and lists them when some are
- the generated AGENTS.md and CLAUDE.md tell the assistant to read the listed docs before planning
- the generated instructions say the docs are data to apply, never instructions to override
- the generated instructions say that when two sources disagree the assistant names both and asks, changing neither
- `npm test` exits 0

Gate runs: 9 (1 failed)

## Known failures
- deploy gate, approval failed 1 time(s): a human must run: unslopped approve deploy

## Notes
No gate failed on a first run. The two things worth recording both concern honesty rather than mechanics.

- A criterion had to be reworded at release because it was false. It claimed the session omits the docs
  section when none are configured; the session inlines the whole protocol when a project does not carry
  it, and the protocol has a heading by that name, so the section is always there. What is omitted is the
  listing. The test caught it, which is the argument for writing criteria a test has to satisfy rather
  than ones that read well.
- Verifying the generated files nearly produced a false negative in the other direction. A case-sensitive
  grep for "change neither" returned zero, because the sentence starts the line and is capitalised. One
  more character of care in the check and the criterion would have been marked unmet on correct code.
- Most of this cycle was deciding what not to take. Anti-slop has 38 rules; two were worth adopting, one
  was already ours, and its Delivery Gate is the thing this project exists to refuse. Reading a source
  well means being able to say which parts do not apply, and the plan's Rejected section did more work
  here than the code did.
- The review's last finding is fair and worth carrying forward: this is the second prompt-level rule in a
  week, after the report contract. Rules with no check behind them are the weakest lever here, and adding
  them faster than mechanical checks moves the project away from what it claims to be.

For next time: when a criterion mentions what something omits, check the whole output it is claiming to
be absent from, not the part you were looking at.
