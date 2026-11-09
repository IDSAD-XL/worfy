# ship-ticket, step 9: Merge — a separate step, on green

Plugin root: `CLAUDE_PLUGIN_ROOT` in this file is the plugin folder, the one that holds `bin/` and `skills/`: the path you read this file from, without `/skills/ship-ticket/<this file>`. Claude Code spells it out only in SKILL.md and the agent definitions, and Bash may have it empty: in every command below put that folder in its place, or start the command with `export CLAUDE_PLUGIN_ROOT=<that folder>;`.

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
there is not `ready` waits, and a `failed` one goes back to rework. A Check that answers on the main
branch after the merge (the same section; worfy: `windows` for scope `pc`) is read there before the
merge — the record of a red main branch holds it — and after the merge you ask its session for it on
the merge commit yourself: no wave ends here to ask for it. With no `check` Stage in the
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

**A ticket of several repositories** — more than one `Repo:` line; such a project merges by people
(`F workflow.merge` `null`). Its PRs never go into a set or a state file of `land`: there is no
`land` across repositories, and nothing here merges them. People merge them in the order of the
`Repo:` lines, the library first. Each PR has its own CI; the ticket's CI is red when any of them is,
except the consumer's CI while its `Release:` line waits: before the release its new version does
not exist yet. The release is the team's step; the orchestrator only notices it — a `tag` is on the
library's remote (`git -C <library checkout> ls-remote --tags origin <tag>`), a `package` version is
published (`npm view <name>@<version> version` in the consumer's checkout, with its registry
settings) — and then takes the consumer's PR out of draft, `gh pr ready <N>` in that checkout. When
the project's `rules.md` says the team does that itself, the orchestrator only reports the release.
A lockfile update after the release is a new head: the review mark is gone from it, and the new
review looks at that delta only. A ticket merged in some of its repositories stays `claimed`, with no
status of its own; a red consumer, or a review that rejects it, is fixed forward in the same ticket.
A revert of a merged PR is never proposed: it is the owner's or the team's decision. When every PR is
merged: `"${CLAUDE_PLUGIN_ROOT}/bin/ticket" done <epic> <NN> --pr <repo>#<N> --pr <repo>#<N>; echo "EXIT=$?"`
— one `--pr` per `Repo:` line; it refuses with exit 2 while one is missing.

**The Evidence lines of the verdict and the CI.** The review verdict and the green final CI check are
written under the items of the ticket's section `F tickets.done_section` at the close, not on the
branch: a line on the branch after CI would make a new head and one more CI run.
- `review` — under each item whose claims the review checked (the `item` of the report's claims):
  `pass` for `VERIFIED`, `fail` for `REJECTED`, `ref` `PR #<N>`.
- `ci-check` — under each item the final CI check proves (an item that names CI, or a test that only
  CI runs): `ref` is the URL of that check's run on the PR head,
  `gh pr checks <N> --json name,link --jq '.[] | select(.name == "<CI check>") | .link'`.

Full mode: these lines go into the state file of `land` as `prs[].evidence` (skill
`/worfy:epic-wave`, section 4, "Merge with land"), and `land` writes them in its documents PR before
`ticket done`. Silent mode (no documents PR): after the verdict and the CI, before `ticket done`, the orchestrator writes them itself:
`"${CLAUDE_PLUGIN_ROOT}/bin/ticket" evidence <epic> <NN> <item> review pass --ref "PR #<N>" --sha <head>` and
`"${CLAUDE_PLUGIN_ROOT}/bin/ticket" evidence <epic> <NN> <item> ci-check pass --ref "<run URL>" --platform ci --sha <head>`,
each with `; echo "EXIT=$?"`; `ticket` puts them into the ticket file in the Workflow folder.
For a ticket of several repositories each line names its PR and its repository: `--ref "PR <repo>#<N>"
--repo <repo> --sha <head of that repository>`.
