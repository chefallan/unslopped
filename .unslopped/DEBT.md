# Debt log

Known deviations we are deliberately not fixing in the change where they were found.
One line each, logged on the spot instead of opening a work item. Sweep the cleanup
items in one batch at a quiet moment; accepted items stay, with the reason, so nobody
re-litigates them.

Categories: cleanup (mechanical, safe to batch), pattern (a wrong shape new code would
copy; fix it before it spreads), soon (costs someone time while it exists), accepted
(evaluated and staying as is).
- [soon] tool hook matches human-only command names inside file content written through shell heredocs (src/hooks.ts) :: logged 2026-08-31, cycle 20260831-08ed52
- [soon] tool hook blocks shell commands that mention the config file next to any greater-than character, arrows included (src/hooks.ts) :: logged 2026-08-31, cycle 20260831-08ed52
- [soon] add CHANGELOG.md before first npm publish :: logged 2026-08-31, cycle 20260831-08ed52
- [pattern] scopeCheck should tolerate a trailing parenthetical note on Files to touch entries (src/practices.ts) :: logged 2026-09-01, cycle 20260831-08ed52
- [soon] config hash treats new practice defaults from an upgrade as mid-cycle tampering; hash the raw file or a stored snapshot instead (src/config.ts) :: logged 2026-09-01, cycle 20260901-3b9ebc
- [pattern] the start refusal message still says finish or reset; it should point at resume first (src/cli.ts) :: logged 2026-09-02, cycle 20260902-4b46ef
