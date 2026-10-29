# ship-ticket, step 8: PR and green CI

Plugin root: `CLAUDE_PLUGIN_ROOT` in this file is the plugin folder, the one that holds `bin/` and `skills/`: the path you read this file from, without `/skills/ship-ticket/<this file>`. Claude Code spells it out only in SKILL.md and the agent definitions, and Bash may have it empty: in every command below put that folder in its place, or start the command with `export CLAUDE_PLUGIN_ROOT=<that folder>;`.

Only with `workflow.finish: pr-green-ci`; with `local-green` — "step 8 skipped: the project
finishes on locally green checks". With `agent-review` before `ci` in the Pipeline (section 0) the PR
is opened only after `review success` on the branch's head (step 7), from that same head.

In Silent mode the PR title and description tell what the change does and why, the way a colleague
would write them: no ticket, epic, ADR or Workflow folder; the story of the ticket goes into its
result section in the Workflow folder. With `F attribution` `off` there is no attribution line.

```bash
gh pr create --fill
gh pr view <N> --json mergeStateStatus
```

**The cross-machine label** (`F cross_machine_gate`; exit code 4 or `null` — the
project has one machine, skip this paragraph and say so). With `F cross_machine_gate.role` `request`,
right after `gh pr create`: the PR's files are compared with `F cross_machine_gate.exempt` — paths
whose change needs no label; a path that ends with `/` is a folder and covers every file under it.
One file outside `exempt` — the PR gets the label `F cross_machine_gate.label`, and its description
gets the section `## <checks_section>` (`F cross_machine_gate.checks_section`): the old description
and the section, through `--body-file`. The section lists the commands of the ticket's acceptance
items (`F tickets.done_section`) that run on the machine with `serve` beyond its `check` — the ticket
marks them itself, the skill does not decide which — one line each, with its expected result:
``- `<command>` — <expected result>``. No such item — the single line `none`. Write those lines into
`<section file>` first; the block prints `label` or `no-label`, or a line starting with `ERROR:`
when `gh` failed or listed no files (right after `gh pr create` the list can still be empty): run the
block again then, never take that for `no-label`. A broken profile (`bin/profile` exit 1) is an
`ERROR:` too, not an absent field:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$@" 2>/dev/null; }
role=$(F cross_machine_gate.role); rc=$?                # 4 — no such field; 1 — a broken profile or registry
if [ "$rc" != 0 ] && [ "$rc" != 4 ]; then echo "ERROR: bin/profile exit $rc: the profile or the registry is broken — run it without 2>/dev/null"
elif [ "$role" != request ]; then echo "label step skipped: cross_machine_gate.role is ${role:-absent}"
elif ! files=$(gh pr view <N> --json files --jq '.files[].path'); then echo "ERROR: gh pr view <N> failed: run the block again"
elif [ -z "$files" ]; then echo "ERROR: PR <N> lists no files yet: run the block again"
else
  exempt=$(F cross_machine_gate.exempt | sed -n 's/^ *"\(.*\)",\{0,1\}$/\1/p')   # one path a line; no field — nothing is exempt
  need=no-label
  while IFS= read -r f; do
    hit=no
    while IFS= read -r e; do
      [ -n "$e" ] || continue
      case "$e" in */) case "$f" in "$e"*) hit=yes ;; esac ;; *) [ "$f" = "$e" ] && hit=yes ;; esac
    done <<EXEMPT
$exempt
EXEMPT
    [ "$hit" = yes ] || need=label
  done <<FILES
$(printf '%s\n' "$files" | tr -d '\r')
FILES
  echo "$need"
  if [ "$need" = label ]; then
    sec=$(F cross_machine_gate.checks_section); B=<scratchpad>/pr-<N>-body.md
    if ! gh pr view <N> --json body --jq .body >"$B"; then echo "ERROR: gh pr view <N> --json body failed: run the block again"
    else
      tr -d '\r' <"$B" | grep -qxF "## $sec" || { printf '\n## %s\n\n' "$sec"; cat <section file>; } >>"$B"
      gh pr edit <N> --add-label "$(F cross_machine_gate.label)" --body-file "$B"; echo "EXIT=$?"
    fi
  fi
fi
```

A description that already has the section keeps it as it is, so a second run adds nothing. The
label goes on only after this machine's own checks are green (step 6, and the other platform's
verdict for a platform PR). `no-label` — the PR goes on as usual.

CI is the PR's checks without the agents' marks: `review`, `check/<name>` and `deploy` are commit
statuses too (`"${CLAUDE_PLUGIN_ROOT}/bin/ticket" mark --contexts` prints their names), and a
`review` failure is a verdict, not red CI. Only commit statuses are left out (an empty
`workflow`): a GitHub Actions job named `deploy` is CI. `CI=pass` is green; `CI=fail`,
`CI=pending` and `CI=none` (no CI run yet) are not:

```bash
gh pr checks <N> --json name,bucket,workflow --jq '[.[] | select(.workflow == "" and (.name == "review" or .name == "deploy" or (.name | startswith("check/"))) | not)] | if length == 0 then "CI=none" elif any(.[]; .bucket == "fail" or .bucket == "cancel") then "CI=fail" elif any(.[]; .bucket == "pending") then "CI=pending" else "CI=pass" end'; echo "EXIT=$?"
```

On a conflict with the base branch the checks do not turn red, they **disappear** ("no checks
reported"): GitHub does not create a CI run for a PR in state `DIRTY`. So look at
`mergeStateStatus`, not only at the list of checks, and on `DIRTY` rebase onto the base before
waiting for CI. A wave's documents commit changes ticket files — after it the wave's open PRs are
usually `DIRTY`. What else the change must fix so that CI does not turn red after the merge —
`rules.md`.

Wait for CI with one long command, not frequent polling: an agent has a limited number of turns,
and a merge was cut off twice in the middle of CI. The Bash call has timeout 600000; if it did not
finish waiting, repeat the same command:

```bash
sha=$(gh pr view <N> --json headRefOid --jq .headRefOid)
id=$(gh run list --branch <branch> --limit 10 --json databaseId,headSha \
       --jq "[.[] | select(.headSha==\"$sha\")][0].databaseId")
if [ -z "$id" ]; then echo "NO RUN"; else
  set -o pipefail; gh run watch "$id" --exit-status --compact --interval 30 | tail -n 5; echo "EXIT=$?"; fi
```

`NO RUN` is not red CI: the run has not been created yet, or the PR is `DIRTY` (see above), or the
PR changes only paths the project's CI skips (`paths-ignore` in the workflow, usually documents).
In the last case the finish is a local gate fast with exit code 0 and a PR comment "CI skipped:
docs-only change". What the project's CI does not run, and so what must run locally before the
merge, — the profile's `rules.md`.

**`F workflow.ci` is `batch`** — skip the CI wait of this step: GitHub CI does not run on the PR,
and `NO RUN`, `CI=none` or old red checks are not a reason to hold it; the agents' marks (`review`,
`check/<name>`, `deploy`) are still set and read as above. The finish is the PR plus a local gate
fast with exit code 0 (step 6). Instead of `mergeStateStatus` and `gh pr checks` look at
`mergeable`: `CONFLICTING` — rebase onto the base; `MERGEABLE` — done; `UNKNOWN` — GitHub is still
computing it, ask again in a minute.

```bash
gh pr view <N> --json mergeable --jq .mergeable   # with workflow.ci batch, instead of the CI wait
```

With `pr` the step stays as above.
