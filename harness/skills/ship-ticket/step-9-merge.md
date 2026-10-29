# ship-ticket, step 9: Merge — a separate step, on green

Only with `pr-green-ci`; the merge is done by whoever `F workflow.merge` names (today always the
orchestrator).

```bash
gh pr merge <N> --squash
```

Status and merge are never joined in one command: the pipe swallows the exit code. When several
waves or workflows run in parallel, a merge and any commit to the main branch go one at a time,
under the shared lock `mkdir "$(git -C <repo> rev-parse --path-format=absolute --git-common-dir)/main.lock"`
(the command and the rule for a stuck lock — skill `/worfy:epic-wave`, section 4).

The Pipeline (section 0) comes first. With `awaiting-merge` there is no merge here: people merge, and
the ticket waits for them. With `human-review` the merge waits for
`gh pr view <N> --json reviewDecision` to say `APPROVED`. With a `check` Stage the PR merges only
while its head carries every `check/<name>` `success` or `skipped`: the marks, who sets them and the
block that reads them — skill `/worfy:epic-wave`, section 4, "Checks before merge"; a PR whose line
there is not `ready` waits, and a `failed` one goes back to rework. With no `check` Stage in the
Pipeline a platform PR — one the project's rules send to another platform's verdict — merges only
after that verdict, the old way: the same section, "Gate before merge".

With `F cross_machine_gate.role` `request` a PR with the label `F cross_machine_gate.label` is not
merged by this machine: the machine with `serve` checks, reports and merges it (skill
`/worfy:gate-queue`). The ticket is blocked with the reason —
`"${CLAUDE_PLUGIN_ROOT}/bin/ticket" block <epic> <NN> "waits for the machine with serve: <label>, PR #<N>"`
(the reason in the docs' language) — and is closed when that PR is merged.

The gate the project requires before this merge is `F workflow.merge_gate` — skill
`/worfy:epic-wave`, section 4, "Gate before merge". With `"wave"`, a single ticket outside a wave
is a set of one PR: the same three blocks, with `PRS=(<N>)`.
With no `merge_gate` and `F workflow.ci` `pr` no gate full runs before the merge: the condition is the
project's final CI check on the PR's head (its `rules.md` names it, for example `ci-ok`) completed
with `success`, no CI run still going on that head, and the `review` mark `success` on the same head.
The orchestrator merges through `bin/land`, a single ticket too — a state file of one PR (skill
`/worfy:epic-wave`, section 4, "Merge with land"). CI on the PR may run only the tests its diff
touches, as the project's `rules.md` says; the push to the main branch runs the whole suite. While
the latest push run on the main branch is red, no PR with code is merged: the fix goes forward for at
most one hour, then the culprit PR is reverted — skill `/worfy:epic-wave`, section 4,
"A red push run on the main branch".

With `F workflow.ci` `batch` the merge does not wait for CI: the PR merges on its gate when
`mergeable` is `MERGEABLE`. A single ticket outside a wave is a wave of one: after its merge, the
batch CI run on the main branch of skill `/worfy:epic-wave`, section 4, "Batch CI on the main
branch" — dispatch, wait, and the same rule for a red run.
