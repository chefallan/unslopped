# Debt log

Known deviations we are deliberately not fixing in the change where they were found.
One line each, logged on the spot instead of opening a work item. Sweep the cleanup
items in one batch at a quiet moment; accepted items stay, with the reason, so nobody
re-litigates them.

Categories: cleanup (mechanical, safe to batch), pattern (a wrong shape new code would
copy; fix it before it spreads), soon (costs someone time while it exists), accepted
(evaluated and staying as is).
- [soon] proposal files get committed and their consumption dirties the release tree; gitignore .unslopped/proposals (src/init.ts) :: logged 2026-09-02
- [pattern] the force-push rule matches anywhere in command text; anchor it at command position (src/hooks.ts) :: logged 2026-09-02
- [pattern] the commit rule matches the filename commit.md in git commands; require commit as the git subcommand (src/hooks.ts) :: logged 2026-09-02
