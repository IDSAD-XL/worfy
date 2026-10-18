---
name: gate-queue
description: Process the cross-machine gate queue — every open PR that carries the label of the profile's cross_machine_gate and waits for this machine — "/worfy:gate-queue", "process the gate queue", worfy's action "Process gate queue". Runs only on the machine whose profile has cross_machine_gate.role serve; skill epic-wave starts its section 1 with it, and worfy Autopilot sends it when it has no wave to run. Rebases each waiting PR, runs the gate full and the commands of the PR's checks section, reports in the PR, then merges it or leaves a red report.
---

# Process the cross-machine gate queue

A project may run on two machines, one of which cannot run the other's gate full (worfy ADR-0069).
The PRs of the machine with `F cross_machine_gate.role` `request` that touch shared code carry the
label `F cross_machine_gate.label` (skill `/worfy:ship-ticket`, step 8), and the machine with
`serve` checks and merges them. This skill is that pass, the only copy of it: skill
`/worfy:epic-wave` runs it as the first step of its section 1, and worfy Autopilot sends it when it
has no wave to run.

Below, `<repo>` is the project root; `F <field>` is short for
`"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field <field>`. Each machine has its own profile,
so the role is that machine's; the label and the section name come from the profile, never from
this text. The report to the user is in `F language.reports`; the report posted in a PR is in
`F language.team`.

## 1. The role of this machine

```bash
r=$("${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field cross_machine_gate.role 2>/dev/null); e=$?; r=${r%$'\r'}
case "$e:$r" in
  0:serve) echo "role serve: processing the queue" ;;
  0:request) echo "queue skipped: role request, the machine with serve processes the queue" ;;
  4:* | 0:null) echo "queue skipped: the profile has no cross_machine_gate, one machine, no queue" ;;
  *) echo "profile error: exit $e" ;;
esac
```

- Exit code 4 or `null` — the project has one machine and no queue: say "queue skipped: the profile
  has no `cross_machine_gate`" and stop.
- `request` — the other machine processes the queue: say so and stop. This machine's own PRs with
  the label wait for it (skill `/worfy:epic-wave`, section 1, the `request` paragraph).
- `serve` — go on.
- Any other exit code — the registry or the profile is broken: stop and pass the stderr message of
  `bin/profile` to the user.

## 2. The waiting PRs

A PR waits for this machine when it is open, carries the label, comes from a branch of this
repository, and has no red report newer than its last commit (rule 1). A report is a comment whose
first line starts with `<checks_section> report: ` — `<checks_section> report: green` or
`<checks_section> report: red` (step 5 below writes it). Only a report by `F github.account`
counts: that is the account the sessions of both machines run `gh` as, and anyone can write a
comment that starts the same way; with no `github.account` no report counts and every labelled PR
waits. "Newer" is strictly later: a report at the same second as the last commit does not end the
wait. The wait counts from the later of two moments: the PR's creation (`createdAt`) and its last
commit (`committedDate`).

A PR with a red report newer than its last commit waits for the `request` machine instead: that
machine fixes and pushes, and another gate full here would change nothing. Its line says so, and the
pass does not touch it. A green report ends no wait: the same pass merges a green PR, so a PR still
open after one is a PR whose merge failed (a conflict with the main branch, the network, the head
moved, the lock) — nothing for the other machine to fix, and the next pass takes it from the start.
Once, not without end: a PR with two green reports newer than its last commit had its merge fail
twice on one head (a rebase onto a main branch that has not moved keeps the head and its commit
date), and a third gate full would change nothing. Its line is `<N> needs owner: …`; the pass does
not touch it, and its row in the table says `needs owner` with the reason, for the owner to look at
the failed merge. A new commit — a rebase onto a moved main branch or a push — makes it wait again.

A PR from a fork is not checked out and the commands of its section are not run — anyone with a fork
writes that description, and this machine would run it as shell. The block prints such a PR as
`<N> fork: skipped`, and it does not wait.

The block filters with `gh`'s own `--jq`, without an external `jq` (Git Bash on Windows has none),
and prints one line a PR, oldest wait first:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$1" 2>/dev/null; }
GQ_SECTION=$(F cross_machine_gate.checks_section) GQ_ACCOUNT=$(F github.account) \
  gh pr list --state open --label "$(F cross_machine_gate.label)" --limit 100 \
  --json number,headRefName,headRefOid,isCrossRepository,createdAt,commits,comments --jq '
  ($ENV.GQ_ACCOUNT | rtrimstr("\r")) as $account | ($ENV.GQ_SECTION | rtrimstr("\r")) as $section
  | [.[] | (.commits[-1].committedDate // .createdAt) as $pushed
   | [.comments[] | select(.author.login == $account)] as $own
   | ([$own[] | select(.body | startswith($section + " report: red")) | .createdAt] | max) as $red
   | ([$own[] | select((.body | startswith($section + " report: green")) and .createdAt > $pushed)] | length) as $green
   | . + {since: ([.createdAt, $pushed] | max), waits: ($red == null or $red <= $pushed), stuck: ($green >= 2)}]
  | sort_by(.since) | .[]
  | if .isCrossRepository then "\(.number) fork: skipped"
    elif .stuck then "\(.number) needs owner: the merge failed after two green reports on head \(.headRefOid), the gate is not run again"
    elif .waits then "\(.number) \(.headRefName) \(.headRefOid) since \(.since)"
    else "\(.number) waits for the requesting machine: its red report is newer than its last commit" end'; echo "EXIT=$?"
```

No line before `EXIT=0` — say `queue empty` and stop. A line `<N> <branch> <head> since <time>` is a
waiting PR; the other lines go into the table at the end as they are.

## 3. The pass, one PR at a time

The waiting PRs go **one at a time**, oldest first: the next PR starts after the previous one is
merged or has its red report, so each rebase is onto the main branch with the previous merge in it.
For each PR, in that order, with `<N>`, `<branch>` and `<head>` from its line:


1. A worktree of its own on the PR's branch as origin has it, rebased onto the fresh base
   `F worktree.base` (already a remote branch, `origin/main`) and pushed. `-B` resets a local branch
   left from an earlier pass: the other machine may have pushed a rework since, and a rebase of the
   old local branch would push it away. The push holds a lease on `<head>`: if the branch moved after
   the list, it is refused and the worktree removed — start the pass again from the list. The steps
   are joined with `&&`: a failed step stops the block, so a rebase never runs in a tree of an earlier
   try and nothing half-rebased is pushed; a tree `<scratchpad>/pr-<N>` left from an earlier try of
   this PR is removed first, and `git worktree prune` drops one deleted by hand that git still lists.
   The line before `EXIT=0` is the new head: the checks run on it and the merge is matched against it.
   A conflict stops the block with the tree kept. A conflict only in the state file
   (`F docs.handoff.path`) the session resolves itself (the session that merges resolves it), stages
   the file and finishes with the second block below. Any other conflict is red, with the conflicting
   files as the reason:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$1" 2>/dev/null; }
B=$(F worktree.base) && [ "$B" != null ] || B=origin/main   # no worktree.base: the main branch
P=<scratchpad>/pr-<N>
gone() { [ ! -e "$P" ] || git -C <repo> worktree remove --force "$P"; }   # the tree of an earlier try of this PR
git -C <repo> fetch origin && gone && git -C <repo> worktree prune && git -C <repo> worktree add -B <branch> "$P" origin/<branch> \
  && git -C "$P" rebase "$B" \
  && { git -C "$P" push --force-with-lease=<branch>:<head> origin HEAD:<branch> || { gone; false; }; } \
  && git -C "$P" rev-parse HEAD; echo "EXIT=$?"
```

   The second block, after the state-file conflict is resolved and staged. Each Bash call starts a
   fresh shell, so nothing of the block above is defined here: the path is written out again, and the
   block refuses unless it is the PR's worktree — `git -C ""` acts in the current folder and would
   push that folder's HEAD into `<branch>`:

```bash
P=<scratchpad>/pr-<N>                                   # written out: nothing carries over between Bash calls
if [ -n "$P" ] && [ -d "$P" ] && case "$(git -C "$P" rev-parse --git-dir 2>/dev/null)" in */worktrees/pr-<N>) true ;; *) false ;; esac; then
  GIT_EDITOR=true git -C "$P" rebase --continue \
    && { git -C "$P" push --force-with-lease=<branch>:<head> origin HEAD:<branch> || { git -C <repo> worktree remove --force "$P"; false; }; } \
    && git -C "$P" rev-parse HEAD; echo "EXIT=$?"
else echo "REFUSED: '$P' is not the worktree of PR <N>: nothing pushed"; fi
```

2. `F cross_machine_gate.check` in that worktree (`<PR worktree>` — `<scratchpad>/pr-<N>`), the way skill `/worfy:epic-wave`, section 4, runs a gate full of one PR — the
   screen check, the e2e lock — with that command in place of the block's last line. Its verdict line
   and exit code go into the report.
3. The commands of the PR's section `F cross_machine_gate.checks_section`, each run in that worktree
   with its exit code. The block prints the section's lines up to the next heading: a command and its
   expected result a line, `none` when the section says there is nothing to run, `no-section` when the
   PR has no such section or it is empty — red, with the reason "no `<checks_section>` section". Only a
   heading of level 1 or 2 outside a code block ends the section, so a `# comment` in a code block
   stays in it:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$1" 2>/dev/null; }
gh pr view <N> --json body --jq .body | awk -v h="## $(F cross_machine_gate.checks_section)" '
  { sub(/\r$/, "") }
  /^```/ { fence = !fence }
  $0 == h { on = 1; next }
  on && !fence && /^##? / { on = 0 }
  on && NF { print; n++ }
  END { if (!n) print "no-section" }'
```

4. CI on the new head — the CI wait block of skill `/worfy:epic-wave`, section 4 (with `F workflow.ci` `batch`: `mergeable`).
5. The report, before any merge, in `<scratchpad>/pr-<N>-report.md`. Its first line is
   `<checks_section> report: green` or `<checks_section> report: red`; then the verdict line of
   `check` and its exit code, each command of the section with its exit code and the tail of its
   output, and with red the reason. Green — `check`, every command of the section and CI are green.
   **No merge without the report.** The first block posts it, once:

```bash
gh pr comment <N> --body-file <scratchpad>/pr-<N>-report.md; echo "comment EXIT=$?"
```

   The second block merges only when the report's first line is green, `gh pr comment` gave exit
   code 0 (`<comment exit>`) and `check` gave exit code 0 (`<check exit>`, step 2).
   `--match-head-commit <new head>` (the last line of step 1) refuses the merge if the branch moved
   after the checks. Red or a rebase conflict — the report with the reason, the label stays, no
   merge. The merge goes under the main-branch lock of skill `/worfy:epic-wave`, section 4, at the
   same path (`--git-common-dir`): this pass may run in a session other than the wave's, so both
   skills take the repository's shared path. A lock younger than 90 minutes is someone's merge: the
   block waits for it. The `trap` releases the lock on any exit, an error and a stopped call too. Run
   the block in one Bash call with timeout 600000; if the lock is not taken in that time, repeat this
   block only — the report is already posted. A failed merge leaves the label and the PR waits again
   (step 2) — once: after a second failed merge on the same head it is `needs owner` (step 2); its row
   in the table says `green, merge failed` with `merge EXIT`. Then
   `git -C <repo> worktree remove --force <scratchpad>/pr-<N>`:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$1" 2>/dev/null; }
v=$(head -n 1 <scratchpad>/pr-<N>-report.md | tr -d '\r')
if [ "<comment exit>" = 0 ] && [ "$v" = "$(F cross_machine_gate.checks_section) report: green" ] && [ "<check exit>" = 0 ]; then
  L="$(git -C <repo> rev-parse --path-format=absolute --git-common-dir)/main.lock"   # the main-branch lock, shared path
  until mkdir "$L" 2>/dev/null; do
    if [ -n "$(find "$L" -maxdepth 0 -mmin +90 2>/dev/null)" ]; then rmdir "$L"; fi   # older than 90 min — stuck
    sleep 30
  done
  trap 'rmdir "$L" 2>/dev/null' EXIT; trap 'exit 130' INT TERM HUP   # released on every exit
  gh pr merge <N> --squash --match-head-commit <new head>; m=$?; echo "merge EXIT=$m"
  [ "$m" = 0 ] && { gh pr edit <N> --remove-label "$(F cross_machine_gate.label)"; echo "EXIT=$?"; }
else echo "no merge: report [$v], gh pr comment exit <comment exit>, check exit <check exit>"; fi
```

The `request` machine does not run its own gate full again on the rebased branch before the merge:
it checks the main branch at the start of its next wave (skill `/worfy:epic-wave`, section 1). This session takes no tickets of
the other machine's epic and does not change their status. Each PR of the pass — its verdict, the
merge or the report — goes into the table of section 4 below.

## 4. Report

A table, one row a PR of the list, in the order of the list:

| PR | Verdict | Merge or report |
|---|---|---|
| #482 | green | merged, label removed |
| #484 | green, merge failed (`merge EXIT=1`) | <URL of the report comment>; waits for the next pass |
| #485 | red: `pnpm icons` exit 1 | <URL of the report comment> |
| #486 | waits for the requesting machine | — |
| #487 | fork: skipped | — |
| #488 | needs owner: the merge failed after two green reports on one head | — |

The block of step 2 printed no PR — the table is the one line `queue empty`. Called from skill
`/worfy:epic-wave`, section 1, the table goes into the wave report (its section 5).
