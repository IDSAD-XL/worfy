# implementer, step 6: the finish by `workflow.finish`

`workflow.finish: "pr-green-ci"` — a PR and green CI. First `gh pr view <N> --json mergeStateStatus`:
with `DIRTY` CI does not start — rebase onto the base. Wait for CI with one long `gh run watch`
command (the block is in skill `/worfy:ship-ticket`, step 8; Bash timeout 600000, if it did not
finish — repeat it), not by frequent polling: your turns are limited. The result — the PR's checks
without the agents' marks `review`, `check/<name>` and `deploy` (commit statuses, not CI; a
`review` failure is a verdict; an Actions job of such a name is CI): `gh pr checks <N> --json name,bucket,workflow --jq '[.[] | select(.workflow == "" and (.name == "review" or .name == "deploy" or (.name | startswith("check/"))) | not)] | if length == 0 then "CI=none" elif any(.[]; .bucket == "fail" or .bucket == "cancel") then "CI=fail" elif any(.[]; .bucket == "pending") then "CI=pending" else "CI=pass" end'; echo "EXIT=$?"`
— green is `CI=pass`. With `workflow.ci: "batch"` GitHub CI does not run on a
PR: the PR and the green step 5 are the finish, and `CI=none` is expected, not a gap. Do not wait
for CI; check `gh pr view <N> --json mergeable` instead — `CONFLICTING` means rebase onto the
base, `MERGEABLE` is done. Say "CI: batch, runs on main after the Wave" in the report. With
`"pr"` (or no field) CI is waited for as above.
`"local-green"` — do not open a PR; you finish at step 5. Before the local merge the
branch must be on top of the main branch (skill `/worfy:ship-ticket`, step 11): that rebase is
yours — when the orchestrator sends the branch back, rebase it onto the main branch in your own
tree, resolve conflicts there and run step 5 again. The merge itself is the orchestrator's.
