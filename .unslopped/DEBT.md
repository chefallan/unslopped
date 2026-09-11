# Debt log

Known deviations we are deliberately not fixing in the change where they were found.
One line each, logged on the spot instead of opening a work item. Sweep the cleanup
items in one batch at a quiet moment; accepted items stay, with the reason, so nobody
re-litigates them.

Categories: cleanup (mechanical, safe to batch), pattern (a wrong shape new code would
copy; fix it before it spreads), soon (costs someone time while it exists), accepted
(evaluated and staying as is).
- [accepted] completing a cycle and archiving it in one compound command trips the commit rule; hooks see state before execution (src/hooks.ts) :: logged 2026-09-02
- [soon] the quiz gate has no row in the phase table of AGENTS.md and CLAUDE.md, so an assistant learns about it only from the gate failure (src/protocol.ts) :: logged 2026-09-09, cycle 20260909-aa49d7
- [soon] quizCheck reports 0 of N right before the human has made any attempt; it should say the quiz is waiting for an answer while attempts is 0 (src/practices.ts) :: logged 2026-09-09, cycle 20260909-aa49d7
- [soon] prTitle picks the most common commit type across the cycle, so bookkeeping commits outvote the one feature commit and the PR opens as chore; there is also no title override flag (src/github.ts) :: logged 2026-09-09, cycle 20260909-aa49d7
- [soon] the plan template gives no hint that ## Approach needs a rung marker, so every first cycle meets the ladder as a gate failure instead of a prompt (src/state.ts) :: logged 2026-09-09, cycle 20260909-b4c7cd
- [soon] ponytail-review and ponytail-audit have no equivalent: no scanner flags over-engineered lines in the diff or across the repo (src/vulns.ts) :: logged 2026-09-09, cycle 20260909-b4c7cd
- [cleanup] log prints only the newest twenty archived cycles with no flag to reach the rest (src/cli.ts) :: logged 2026-09-10, cycle 20260910-0298d5
- [soon] the bloat scanner's repo pass reads only js and ts while the diff pass reads every non-skipped file, so the two disagree about coverage (src/lean.ts) :: logged 2026-09-10, cycle 20260910-c3ca7f
- [cleanup] the bloat scanner spends its cap in file order, so later files are never read and fixing an early file surfaces findings that look new (src/lean.ts) :: logged 2026-09-10, cycle 20260910-c3ca7f
- [cleanup] unslopped debt has no flag to print past the five-row cap, so a sweep has to open DEBT.md by hand (src/cli.ts) :: logged 2026-09-10, cycle 20260910-9c2581
- [soon] pr status reports no pull request in draft mode because cycle.pr is never set when the human opens the PR by hand (src/pr.ts) :: logged 2026-09-11, cycle 20260911-fcd1d0
