---
name: add-the-review-workflow-this-project-documents-but-never-ran
title: Add the review workflow this project documents but never ran on its own pull requests
created: 2026-09-11T03:18:35.051Z
updated: 2026-09-11T03:18:35.051Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 2
lastCycle: 20260911-1c932e
tags: add, review, workflow, project, documents, but, never, ran, test
---
# Add the review workflow this project documents but never ran on its own pull requests

## When to use
Requests like:
- "Add the review workflow this project documents but never ran on its own pull requests"

## Playbook
Files touched:
- .github/pull_request_template.md
- .github/workflows/unslopped-review.yml
- CHANGELOG.md
- test/style-secrets.test.ts

Acceptance criteria that passed:
- .github/workflows/unslopped-review.yml exists and its contents match what ciWorkflow() generates
- the workflow triggers on pull requests opened, synchronized and reopened, and on nothing else
- the workflow asks for pull-requests write and contents read, and no other permission
- the workflow passes GITHUB_TOKEN from secrets and hardcodes no credential of any kind
- .github/pull_request_template.md exists
- `npm test` exits 0

Gate runs: 10 (2 failed)

## Known failures
- code gate, scope failed 1 time(s): 1 changed file(s) are not in the plan's "## Files to touch":
- deploy gate, approval failed 1 time(s): a human must run: unslopped approve deploy

## Notes
One gate failure, the scope check, and it was a plan formatting mistake rather than real scope creep.

- The entry for the test file wrapped onto two lines, so the parser read the first line as a whole entry
  with an unclosed parenthesis and matched nothing. Same class of error as the colon suffix two cycles
  ago. A files-to-touch entry has to be one line: path, then a parenthetical that opens and closes on
  that line. Worth stating in the protocol, because it has now cost two cycles.
- The self-check test was added mid-cycle for a good reason. The criterion said the workflow contents
  match `ciWorkflow()`, and the only way to verify that without a test is to read the file and trust
  myself. Writing the criterion that way is what forced the test; a vaguer criterion would have let an
  eyeball pass for a check.
- Proving it red meant moving `.github` out of the tree, running red, and moving it back. Cheap, and it
  is the only honest way to red a test for files that already exist.
- `unslopped init --ci` with no `--only` wrote instruction files for four assistants this repository has
  never tracked. Generators that do more than asked are a trap when the scope check is watching, and the
  fix was to delete four paths before staging. `--only` should probably be implied by what the config
  already lists as assistants, since the config named all six but only two were ever committed.

For next time: one line per files-to-touch entry, and pass `--only` to `init` in a repository that
tracks a subset of the assistant files.
