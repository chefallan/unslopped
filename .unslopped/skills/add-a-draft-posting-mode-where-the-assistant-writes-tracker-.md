---
name: add-a-draft-posting-mode-where-the-assistant-writes-tracker-
title: Add a draft posting mode where the assistant writes tracker and pull request text for the human to post
created: 2026-09-11T13:33:27.179Z
updated: 2026-09-11T13:33:27.179Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 2
lastCycle: 20260911-fcd1d0
tags: add, draft, posting, mode, assistant, writes, tracker, pull, src, test
---
# Add a draft posting mode where the assistant writes tracker and pull request text for the human to post

## When to use
Requests like:
- "Add a draft posting mode where the assistant writes tracker and pull request text for the human to post"

## Playbook
Files touched:
- AGENTS.md
- CHANGELOG.md
- CLAUDE.md
- README.md
- package.json
- src/cli.ts
- src/config.ts
- src/pr.ts
- src/protocol.ts
- src/state.ts
- src/tracker.ts
- src/types.ts
- test/draft.test.ts

Acceptance criteria that passed:
- with posting set to draft, a phase change writes the tracker comment to .unslopped/proposals/tracker.md and makes no network call
- the tracker draft records the status the cycle would have moved to, not only the comment text
- with posting set to draft, `unslopped pr` writes the proposal, pushes the branch, and creates no pull request
- with posting set to draft, `unslopped pr` prints where the text is so the human can post it
- with posting set to draft, `unslopped review --pr=<n>` writes its findings and posts none
- with posting left at auto, the tracker and the pull request behave exactly as they do now
- posting defaults to auto, so an existing project keeps its tracker integration on upgrade
- an unknown posting value is refused rather than silently treated as draft
- `npm test` exits 0

Gate runs: 10 (2 failed)

## Known failures
- code gate, scope failed 1 time(s): 2 changed file(s) are not in the plan's "## Files to touch":
- deploy gate, approval failed 1 time(s): a human must run: unslopped approve deploy

## Notes
One gate failure, the scope check again, and this time it was real rather than formatting: `notifyTracker`
needed a `root` to write the draft file, which meant touching `cli.ts` at four call sites and widening
`proposalPath` in `state.ts`. Neither was in the plan because neither was visible until the signature
changed.

- That is the scope check doing its job rather than a mistake to avoid. A function that writes a file now
  needs to know where the repository is, and the plan was written before that was obvious. Declaring the
  two files with the reason took a minute; guessing them in advance would have been guessing.
- The interesting decision was not the mode, it was what draft mode does **not** stop. Pushing the branch
  stays, because refusing it leaves the human unable to open the pull request the mode exists to hand
  them. A rule applied without that exception would have been consistent and useless.
- Draft mode also skips `approve pr`, which took a second look. The approval exists so a human reads the
  text before it goes out; in draft mode the human is the one sending it, so the gate would ask them to
  approve their own message. Keeping it would have been ceremony pretending to be safety.
- The default is the part most likely to be wrong later. `auto` keeps working integrations working, and
  the argument for it is that configuring a tracker credential is the consent to post. If that turns out
  to be too generous, the flip is one line and a changelog note.
- Four review findings, all minor, one logged: `pr status` reports no pull request in draft mode because
  `cycle.pr` is never set when the human opens it by hand. That is the seam where this mode is thinnest.

For next time: when a function starts writing files, expect its callers to join the plan.
