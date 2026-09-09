---
name: add-a-pr-quiz-gate-that-asks-the-approving-human-comprehensi
title: Add a pr quiz gate that asks the approving human comprehension questions generated from the diff
created: 2026-09-09T23:08:46.707Z
updated: 2026-09-09T23:08:46.707Z
runs: 1
completed: 1
abandoned: 0
gateFailures: 4
lastCycle: 20260909-aa49d7
tags: add, pr, quiz, gate, asks, approving, human, comprehension, src, test
---
# Add a pr quiz gate that asks the approving human comprehension questions generated from the diff

## When to use
Requests like:
- "Add a pr quiz gate that asks the approving human comprehension questions generated from the diff"

## Playbook
Files touched:
- CHANGELOG.md
- package.json
- src/cli.ts
- src/gates.ts
- src/practices.ts
- src/quiz.ts
- src/types.ts
- test/quiz.test.ts

Acceptance criteria that passed:
- `unslopped quiz --file=<quiz.md>` stores the questions and prints how many it read, with no answer letter in the output
- `unslopped quiz --answer=<letters>` grades the stored quiz, prints the score, and records the attempt on the cycle
- a wrong answer fails the deploy gate, and the failure names which question numbers were missed and how many attempts are left
- the deploy gate reports the quiz as skipped when the diff is smaller than `practices.quiz.minLines`
- a passing quiz recorded before the last commit fails the deploy gate and says the code changed after the quiz
- running out of attempts fails the deploy gate and tells the human the quiz has to be regenerated
- `practices.quiz.enabled` defaults to false, and the deploy gate of a project without the key runs exactly as it does now
- `npm test` exits 0

Gate runs: 12 (4 failed)

## Known failures
- code gate, scope failed 1 time(s): 6 changed file(s) are not in the plan's "## Files to touch":
- release gate, clean tree failed 2 time(s): uncommitted changes:
- release gate, commits failed 1 time(s): no commits since cycle start
- release gate, no open questions failed 1 time(s): 1 open question(s) in the plan. work past release carries none: get each answered by the human, record the answer, then remove or mark it re
- deploy gate, approval failed 1 time(s): a human must run: unslopped approve deploy

## Notes
Three gate failures, each one the gate doing its job, plus two tool flaws found by using them.

- Code gate, scope. The "## Files to touch" list carried its reason after a colon, so scopeCheck read
  "src/types.ts: QuizQuestion, ..." as the whole entry and matched no file. It strips a trailing
  parenthetical, not a colon suffix. Reasons belong in parentheses. Worth a line in the protocol, because
  the colon form reads better and fails silently.
- Release gate, open questions. Writing "None. The seat and the phase are decided above." under
  "## Open questions" counted as an open question. EMPTY_SECTION matches "none" alone, nothing longer.
- Release gate, clean tree. Three separate approved commits were needed: the feature, the debt log, and
  the plan file. The hook blocks a bare git commit, which is correct and caught an attempt to fold the
  debt log in with a plain git commit.
- The config held the pre-rename GitHub repo, so `unslopped pr` pushed the branch and then got a 404 from
  the old name. The drift check forced a human approval for the one-line fix, which is the right shape.
- prTitle picked chore over feat, because two bookkeeping commits outvoted the one feature commit, and it
  offers no title override. The PR opened as chore and needed `gh pr edit`. Logged as debt.

For next time: put reasons in parentheses in "## Files to touch", write "None" alone under
"## Open questions", and expect one approved commit per artifact rather than one for the cycle.
