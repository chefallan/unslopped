---
name: require-a-review-artifact-on-this-repository-so-a-cycle-cann
title: Require a review artifact on this repository so a cycle cannot release without one
created: 2026-09-11T15:09:07.236Z
updated: 2026-09-11T15:09:07.236Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 6
lastCycle: 20260911-8a5730
tags: require, review, artifact, repository, cycle, cannot, release, without, test
---
# Require a review artifact on this repository so a cycle cannot release without one

## When to use
Requests like:
- "Require a review artifact on this repository so a cycle cannot release without one"

## Playbook
Files touched:
- CHANGELOG.md
- test/style-secrets.test.ts
- unslopped.config.json

Acceptance criteria that passed:
- practices.reviewArtifact is true in this repository's config
- a test fails if this repository ever sets reviewArtifact back to false
- this cycle's own release gate refuses until a review is recorded after its last commit
- the release gate names the review artifact in its checks rather than skipping it
- `npm test` exits 0

Gate runs: 14 (6 failed)

## Known failures
- release gate, clean tree failed 5 time(s): uncommitted changes:
- release gate, criteria verified failed 1 time(s): 5 acceptance criterion(s) not ticked [x] in the plan. verify each one, then tick it:
- release gate, style failed 2 time(s): 1 style problem(s) in the diff. write precisely and directly:
- release gate, review artifact failed 2 time(s): no review recorded. run `unslopped review` (practices.reviewCommand, a second agent, or --file=<review.md>) before release
- deploy gate, approval failed 1 time(s): a human must run: unslopped approve deploy

## Notes
Ten gate runs for an eleven-line diff, because the gate this cycle turned on applied to the cycle that
turned it on. That was the point, and it was worth watching.

- The release gate refused three times, each time correctly. First with no review recorded. Then with a
  review that had gone stale, because a one-word changelog fix added a commit after it. Then on a dirty
  tree, because the review artifact itself was uncommitted.
- The staleness rule is sharper than it looks. Any commit invalidates the review, including a typo fix,
  so the real order is: finish everything, then review, then release. Front-loading the review wastes it.
- `lastCommitMs` excludes `.unslopped/`, so committing the review artifact does not invalidate the review
  it contains. Without that exclusion the gate would be unsatisfiable, and it is the kind of detail that
  only shows up when the gate is switched on.
- The style gate caught a filler word in the changelog sentence describing this change, which is twice
  now that writing about a rule has broken the rule.
- The finding worth acting on is not this setting. Seven cycles ran before anyone asked whether the
  review gate was on, and nothing anywhere lists which practices are off. A project can carry a disabled
  gate forever without it appearing in `status`, `resume` or any report.

For next time: review last, after the final commit, and treat any later commit as a reason to review
again rather than an inconvenience.
