# Debt log

Known deviations we are deliberately not fixing in the change where they were found.
One line each, logged on the spot instead of opening a work item. Sweep the cleanup
items in one batch at a quiet moment; accepted items stay, with the reason, so nobody
re-litigates them.

Categories: cleanup (mechanical, safe to batch), pattern (a wrong shape new code would
copy; fix it before it spreads), soon (costs someone time while it exists), accepted
(evaluated and staying as is).
- [soon] the harness dialog shows only the command line and tool description; carry the decision text in the approve command and verify it against the proposal (src/cli.ts) :: logged 2026-09-02
- [accepted] completing a cycle and archiving it in one compound command trips the commit rule; hooks see state before execution (src/hooks.ts) :: logged 2026-09-02
