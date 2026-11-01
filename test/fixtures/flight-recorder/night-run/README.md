# Night Run fixture

The shared fixture of the worfy-flight-recorder Epic: the real Autopilot Run `2026-10-17T22-29-32-707Z-58e783`
(Epic `worfy-pipeline`, 4 h 48 min, Wave 1 with Tickets 03 and 07, Wave 2 with Tickets 04 and 05, stopped with
`blocked-tickets`). Tickets of the Epic read it; a Ticket that needs a piece missing here adds a new file and
does not change the existing ones.

Anonymised: the home folder is `/Users/someone` (the Claude project folder is named after it,
`-Users-someone-Stuff-CanvasForAI`, and the Journal's `project` is `projectId` of that path, `CanvasForAI-38cb72ec`), user names and e-mail addresses are replaced, the repository owner is
`owner` (`github.com/owner/worfy`). Timestamps, Run, Session, agent, tool-use and commit ids are kept.

| Path | What | Layout of |
|---|---|---|
| `data/autopilot/<run>.jsonl` | the Journal of the Run, whole | `WORFY_DATA_DIR` |
| `claude/projects/-Users-someone-Stuff-CanvasForAI/<session>.jsonl` | excerpt of the Orchestrator transcript: the `user`, `assistant`, `queue-operation`, `queued_command` and `task_status` records between 22:29 and 03:18 UTC; only the fields the transcript readers use, every text cut to 100 characters (a `<task-notification>` after its `</summary>`, so `task-id`, `tool-use-id`, `status` and `summary` stay), thinking blocks dropped | `WORFY_CLAUDE_HOME` |
| `claude/projects/…/<session>/subagents/agent-<id>.meta.json` | the meta of the 12 Subagents the Orchestrator started in the Run, whole | `WORFY_CLAUDE_HOME` |
| `claude/projects/…/<session>/subagents/agent-<id>.jsonl` | excerpt of each Subagent transcript: its first two and last two records and the two records around each pause of 5 min or more (a `SendMessage` rework resumes the same file) | `WORFY_CLAUDE_HOME` |
| `gh/pr-view-<n>.json` | `gh pr view <n> --json number,headRefName,state,createdAt,mergedAt,statusCheckRollup,comments,commits,files,labels,mergeCommit` for PR #457 (03), #460 (07), #467 (04), #468 (05); comment bodies cut to 400 and commit messages to 200 characters | the gh stand-in (`WORFY_GH`) |
| `gh/run-list-worfy-pipeline-<NN>.json` | `gh run list --branch worfy-pipeline/<NN> --json status,conclusion,event,createdAt,updatedAt`: empty, CI ran on `main` in that batch-CI period | the gh stand-in |
| `gh/run-list-main.json` | `gh run list --branch main` of the night (the batch CI runs the Orchestrator started), with `headSha`, `name`, `databaseId`, `attempt` | the gh stand-in |
| `prs.json` | the four `pr view` answers with the runs of their branch as `ciRuns`: the `--prs` file of `scripts/critical-path.mjs` | `--prs` |
| `harness/gate/state/logs/<tag>/<run>/timings.json` | two gate runs: the gate full before the merge of #457 and of #460 | `WORFY_HARNESS_HOME` |

The gate runs are **illustrative**: the real logs of that night are gone (`harness/hooks/gate-log.mjs` keeps 10
runs per worktree and drops the folder of a removed worktree after 8 days). Their format is that of
`timings.json`, the tag is `worktreeTag` of the worktree path, the heads are the heads #457 and #460 were merged
with, and the times lie inside the merge tasks the Journal names ("Rebase, gate full and merge PR 457/460");
the step durations are made up.

## CI that night ran in batch on `main`

The night fell in the batch-CI period: CI did not run on PR branches (the `run-list-worfy-pipeline-<NN>.json`
answers are empty, `ciRuns` in `prs.json` too, and #457, #460, #467 have no checks on their head; #468 carries only
the `review` and `check/windows` statuses). The Orchestrator started CI by hand (`workflow_dispatch`) on `main`
after merges, and `gh/run-list-main.json` holds those four runs. A run belongs to a PR through the PR's
`mergeCommit.oid`:

| Run on `main` (`headSha`) | Created | PR |
|---|---|---|
| `9cbe6794` | 23:51:46 | #457: merge commit `8f0f945f`, then the docs commit `9cbe6794` (#458) on top of it |
| `0e60b0f7` | 00:39:39 | none of the four: `worfy-windows 05f` (#459), merged between #457 and #460 |
| `62a4c4ab` | 00:53:30 | #460: its merge commit |
| `e074b41f` | 03:02:21 | #467: its merge commit |

#468 was merged on 2026-10-18 at 15:58, after the Run; no run of this file covers it.

