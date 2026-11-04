# implementer, step 6: the finish by `workflow.finish`

Plugin root: `CLAUDE_PLUGIN_ROOT` in this file is the plugin folder, the one that holds `bin/` and `skills/`: the path you read this file from, without `/skills/ship-ticket/<this file>`. Claude Code spells it out only in SKILL.md and the agent definitions, and Bash may have it empty: in every command below put that folder in its place, or start the command with `export CLAUDE_PLUGIN_ROOT=<that folder>;`.

**Evidence lines first, before the PR** (with `local-green` — before the report). An Evidence line is
a nested list item under an item of the ticket's section `tickets.done_section`: what proved the item
and where. The section numbers its checkbox items from 1; `"${CLAUDE_PLUGIN_ROOT}/bin/ticket" evidence <epic> <NN>` prints them with their numbers. For
each item a check of step 5 proved, write one line:
`"${CLAUDE_PLUGIN_ROOT}/bin/ticket" evidence <epic> <NN> <item> <kind> pass --ref '<ref>'; echo "EXIT=$?"`.
The quotes around `<ref>` are single: in double quotes the shell runs what stands in backticks.
- `<kind>`: `test-run` — a test command, and `--ref` is the command in backticks with its exit code
  (``'`<test command>` exit 0'``); `gate` — the gate of step 5, `--ref` ``'`gate fast` exit 0'``;
  `commit` — the item is the change itself, and `--ref` is the commit's subject.
- A line is bound to the commit the checks ran on: `--sha` defaults to `HEAD`, so commit the change before step 5, or pass `--sha <that commit>`.
  The platform defaults to this system's; add `--copy dev` when the check ran a dev build of the app.
- `--ref` is one line without ` · `, and it names no host, no user name in a path, no email and no token.
- A picture as Evidence: an item about how something looks gets a screenshot of the app's window in both themes (`screenshot`), an item about motion a clip with its contact sheet (`video`), any other item none, since a test with its exit code proves it. Which build, and when `scrub:` goes on the line: the manual GUI checks of `/worfy:ship-ticket`, step 6.
- Only `pass`: a red check is your work (step 5), not a line. A manual item (`tickets.manual_mark`) gets no line from you.
  An item no check of yours proved gets no line and goes into `not_verified`.
- `EXIT=2` — the line was refused (its grammar or the item number), and nothing was written: fix the arguments.
  `EXIT=1` — an argument error (an unknown flag, or a flag without its value), and nothing was written either.
- Commit the ticket file with its lines on your branch, after the checked commit: the lines go into the PR diff and the review.
  In Silent mode `ticket` writes them into the ticket file in the Workflow folder, and the branch gets nothing.
- In the report, each claim that proves an item carries its number in `item`.

`workflow.finish: "pr-green-ci"` — a PR and a green step 5 (gate fast); after the PR you wait for nothing.
The orchestrator waits for CI after your report. The CI wait of skill `/worfy:ship-ticket`, step 8, is the main session's and the orchestrator's, not yours. Check `gh pr view <N> --json mergeStateStatus` once:
with `DIRTY` CI does not start — rebase onto the base and push. Then read the PR's CI once — its
checks without the agents' marks `review`, `check/<name>` and `deploy` (commit statuses, not CI; a
`review` failure is a verdict; an Actions job of such a name is CI): `gh pr checks <N> --json name,bucket,workflow --jq '[.[] | select(.workflow == "" and (.name == "review" or .name == "deploy" or (.name | startswith("check/"))) | not)] | if length == 0 then "CI=none" elif any(.[]; .bucket == "fail" or .bucket == "cancel") then "CI=fail" elif any(.[]; .bucket == "pending") then "CI=pending" else "CI=pass" end'; echo "EXIT=$?"`
— and put its answer into the report as it is: `CI=pending` or `CI=none` is expected, not a gap, and
the report does not call CI green unless it says `CI=pass`. Do not wait for CI: no `gh run watch`, and no second `gh pr checks` or `mergeable` call after that one check.
With `workflow.ci: "batch"` GitHub CI does not run on a PR: the PR and the green step 5 are the
finish, and `CI=none` is expected, not a gap. Check `gh pr view <N> --json mergeable` once instead
of the CI read — `CONFLICTING` means rebase onto the base, `MERGEABLE` is done, `UNKNOWN` — GitHub
is still computing it; do not ask again: `UNKNOWN` goes into the report as it is, and the orchestrator
reads `mergeable` again before the merge. Say "CI: batch,
runs on main after the Wave" in the report.
`"local-green"` — do not open a PR; you finish at step 5. Before the local merge the
branch must be on top of the main branch (skill `/worfy:ship-ticket`, step 11): that rebase is
yours — when the orchestrator sends the branch back, rebase it onto the main branch in your own
tree, resolve conflicts there and run step 5 again. The merge itself is the orchestrator's.
