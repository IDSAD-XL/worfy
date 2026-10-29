# implementer, step 6: the finish by `workflow.finish`

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
