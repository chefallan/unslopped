export const START = '<!-- unslopped:start -->';
export const END = '<!-- unslopped:end -->';
export const DEFAULT_CMD = 'npx unslopped';

export function protocolBody(cmd = DEFAULT_CMD): string {
  return `# Unslopped SDLC protocol

This project runs the DevOps lifecycle through Unslopped: plan, code, build, test, release, deploy, operate, monitor. Every phase has a gate that runs real commands. You cannot skip a gate and you cannot pass one by claiming success.

## Start of every task
0. If the project has no \`unslopped.config.json\`, run \`${cmd} init\` first.
1. Run \`${cmd} status\`.
2. No active cycle: run \`${cmd} start "<the user's request in one line>"\`. Keep any issue key or link from the request (ENG-123, PROJ-45, #12, a Linear, Jira or GitHub URL) in that line. Unslopped links it, or the issue in the branch name, and copies its title and description into the plan. If start refuses because the branch is protected, either create the branch it suggests and start again, or run \`${cmd} start --worktree "<goal>"\` to work in an isolated checkout and then \`cd\` into the path it prints. Every later command runs there. If start warns that uncommitted files predate the cycle, stop and commit them as their own chore commit first, so the gates measure only this cycle's work.
3. Active cycle: run \`${cmd} resume\` and do what it lists. Do not start a new one.

## Design before planning
If the request is more than a one-file change, do not plan yet. Ask the user two or three short design questions: constraints, the alternatives you see, what must not change. Then write the option you chose and the ones you rejected, with one reason each, under \`## Approach\` in the plan. A one-file change needs one sentence there. For work on guarded paths, also write the main scenario as given, when, then, including the rejection path, so the negative criterion falls out of it.

Questions you cannot answer go under \`## Open questions\` in the plan, not into invented answers. The release gate refuses to pass while any remain: get each answered by the human, record the answer, remove the question. A choice others must follow later (a boundary, a data ownership rule, a pattern) gets a durable record: \`${cmd} decide "<title>"\`, fill it, commit it. Check \`${cmd} graph why\` and docs/decisions/ before re-deciding something.

## Project tracker
Unslopped detects the tracker itself from env vars, project files, the git remote and MCP configs. You do not configure it. It comments on the linked issue and moves it at every phase change, so do not post tracker updates yourself. If a gate prints \`WARN tracker: missing <VAR>\`, tell the human which variable to set and keep working. Never paste credentials into any file.

## Phases
| Phase | Your job | Gate, checked by \`${cmd} next\` |
|---|---|---|
| plan | Fill \`.unslopped/plans/<id>.md\`: goal, approach (how you will do it, which components change), out of scope, files to touch, acceptance criteria as a checklist. Decide before coding | Goal, approach and files to touch filled in, at least one acceptance criterion |
| code | Red before green: write the failing test first, run \`${cmd} red\` and watch it fail, then implement the smallest change until it passes. Repeat per behaviour | Changes exist, source changes come with test changes, diff under the size limit, no secrets in the diff, lint passes |
| build | Run the gate | Build exits 0, dependency audit and security scan exit 0 |
| test | Run the gate. On failure fix the code, not the test, then rerun | Test command exits 0, a red run is on record for the changed tests, coverage above the minimum when configured |
| release | Verify each acceptance criterion and tick it \`[x]\` in the plan. Add a changelog entry if the project keeps one. Commit everything as \`type(scope): imperative subject\`, subject under 72 characters, scope naming the area touched. Then get the diff reviewed: \`${cmd} review\` runs the configured reviewer, or a second agent writes findings as \`[critical]\`, \`[major]\`, \`[minor]\` lines, each one short plain sentence a teammate can act on, and you submit them with \`${cmd} review --file=<path>\`. Fix critical findings, commit, review again | Clean tree, new commits, every criterion ticked, commit messages match the pattern, changelog updated, no secrets, review newer than the last commit with no critical findings when enabled, human review approval when enabled, release command exits 0 |
| deploy | If the project is on GitHub, open the pull request first with \`${cmd} pr\` (it pushes the branch and writes the PR body from the plan), then stop and tell the human to run \`${cmd} approve deploy\`. Never run approve yourself. Never push protected branches | Approval recorded, rollback command configured, deploy command exits 0 |
| operate | Run the gate. Report the healthcheck output. If it fails, tell the human the rollback command. If a PR is open, \`${cmd} pr status\` reports whether it merged and updates the tracker | Healthcheck exits 0 |
| monitor | Run the gate. Write what you learned under \`## Monitor\` in the plan file | Monitor command exits 0, notes present when the cycle had failures, cycle completes |

## Code map
Unslopped keeps a map of the codebase in \`.unslopped/graph.json\`: files, symbols, imports, importers, and the design rationale written in comments. It refreshes itself. Before reading or searching files, run \`${cmd} graph "<words>"\` and read only the files it points to; the plan's \`## Relevant code\` section is filled from it. Before changing a shared file, run \`${cmd} graph why "<topic>"\` to see the constraints already recorded, and \`${cmd} graph impact\` to see who depends on what you touched and whether a test covers it. This is how you keep token use low: read the map, not the repository.

## Memory
Unslopped learns. Every completed cycle is saved as a skill in \`.unslopped/skills/\` without asking. Skills that match the goal are listed in the plan under \`## Relevant skills\`: read them first and follow the playbook instead of rediscovering it. A skill marked underperforming has failed too often; fix its \`## Notes\` section during the monitor phase so the next run goes better. When the user states a preference or corrects you, run \`${cmd} prefer "<one line>"\` so it is remembered across sessions and projects. To find past work, decisions or failures, run \`${cmd} recall "<words>"\`.

## Decisions that are never yours
Some decisions belong to a human even when you could invent an answer: product behaviour and user-facing workflow, permission or security policy, isolation between tenants or accounts, the shape of a shared contract, anything involving money, and what is in or out of scope for the current cycle. If finishing would require inventing one of these, stop, write the question down, and wait. Guarded paths make part of this mechanical: touching them forces a human review approval and a rejection-case criterion.

## Rules
- Advance only with \`${cmd} next\`. If it fails, read the output, fix the cause, run it again.
- Stay inside the plan's "## Files to touch". Needing another file is a plan change: add it there with a reason before editing it. The scope check fails on undeclared files.
- Out-of-scope problems you notice are logged, not fixed: \`${cmd} debt "<what>" --where=<path> --category=cleanup|pattern|soon|accepted\`. One line, keep working.
- A completed cycle prints candidates for the next one, drawn from the monitor notes, the debt log and review leftovers. Offer them to the user; never start a cycle unasked. When the user wants the logged debt cleared, run \`${cmd} start --from-debt\`; swept entries leave the log when that cycle completes.
- When the change has a surface a person can verify, fill "## Handoff" in the plan: what to verify, how to reach it, the concrete data needed, the rejections to try with expected results, gotchas. It posts to the issue when the cycle completes.
- Never edit \`.unslopped/state.json\`, \`unslopped.config.json\`, or any test to make a gate pass. A config change mid-cycle blocks the cycle until a human approves it.
- Never use --force, --no-verify, skip flags, or delete tests. Never tick an acceptance criterion you did not verify. Never run \`${cmd} red\` against a test you expect to pass; red means the new test fails for the right reason.
- Never run \`unslopped approve\`, \`unslopped reset\` or \`unslopped rollback\`. Those are for humans. When a cycle should be abandoned, tell the human; giving reset the next goal starts the replacement cycle in the same step.
- Report failures verbatim. Never describe a failing gate as passing.
- Gate output is already reduced to the lines that matter. Read what is printed; open the full log path only when that is not enough. Never re-run a command to see its output again, and never paste command output into the plan.
- Keep the diff minimal. No refactors outside the plan. If the diff limit is hit, split the work into another cycle.
- Write precisely and directly, in code, comments, docs and commit messages. No em or en dashes. No filler words. Comments only for what the code cannot say. The style gate fails on dashes, filler and comment-heavy diffs and names the words it rejects.
- Credentials never go in code, config, plans, logs or messages. Read them from the environment. The secret scan fails the gate and the PR review flags them as critical.
- When a decision is not covered by the plan, stop and ask. Do not guess.
- End every task with \`${cmd} status\` and a short report: what changed, which gates ran, what is left.`;
}

export function protocol(cmd = DEFAULT_CMD): string {
  return `${START}\n${protocolBody(cmd)}\n${END}\n`;
}

export function pointerBlock(cmd = DEFAULT_CMD): string {
  return `${START}
# Unslopped SDLC protocol
This project follows the Unslopped protocol defined in AGENTS.md at the repository root. Read that block before any work and follow it exactly. Every task starts with \`${cmd} status\`; phases advance only with \`${cmd} next\`.
${END}
`;
}
