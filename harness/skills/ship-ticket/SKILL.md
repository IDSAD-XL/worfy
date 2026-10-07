---
name: ship-ticket
description: Carry one ticket of any registered project from claim to the finish its profile declares — worktree or main checkout, reserved ADR/migration numbers, failing test first, bare verification runs, review agents, then PR + green CI + merge + production check, or locally green checks. Project commands, paths, deploy and numbering come from `${CLAUDE_PLUGIN_ROOT}/bin/profile`. Use when starting or resuming work on a ticket from the project's ticket folder (`tickets.path`, e.g. .scratch/<эпик>/issues/), or when running a wave of them.
---

# Carry a ticket from claim to finish

The loop below is one ticket. A wave is the same loop for every ticket (skill `/worfy:epic-wave`),
but ADR and migration numbers are taken in advance and one at a time, otherwise the second branch
to merge gets stuck.

Everything project-specific — commands, paths, deploy, numbers, the state file — comes from the
project profile (`${CLAUDE_PLUGIN_ROOT}/bin/profile`, contract:
`${CLAUDE_PLUGIN_ROOT}/profiles/README.md`). Below, `<repo>` is the project root or the worktree
where the work happens; `F <field>` is short for
`"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field <field>`.

**Harness paths in profile values.** A profile value that starts with `~/.claude/bin/` is read as `${CLAUDE_PLUGIN_ROOT}/bin/` followed by the rest of the value.
Schema-1 profiles carry such values in `tickets.status_tool`, `tickets.epic_status`,
`workflow.preflight` and `numbering.reserve_with`; they point into the frozen pre-plugin Harness, so
run the plugin's copy instead. A bare skill name in `workflow.ticket_skill` (`ship-ticket`) means
`/worfy:ship-ticket`. Placeholders inside profile values (`<эпик>` — the epic, `<NN>` — the ticket
number, `<slug>`, `<ветка>` — the branch, `<имя-тикета>` — `<NN>-<slug>`, `<что-ревьюишь>` — what
is reviewed, `<файл>` — a test file) are part of the profile contract: substitute them as written.

## 0. Profile

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --name; echo "EXIT=$?"
```

- `0` — work by the profile.
- `3` — the project is not registered or has no profile. **Stop**: tell the user "project <repo>
  is not registered — there is no profile, nothing for ship-ticket to work by" and offer to create
  a profile (`${CLAUDE_PLUGIN_ROOT}/profiles/README.md`, the section on a new project). Do not
  guess commands.
- `1`, `2` — the registry or the profile is broken, or the path is wrong: stop, pass the stderr
  message to the user.

A step that depends on a field runs only if the field exists. `F <field>` returned exit code 4 or
printed `null` — the step is skipped, and that is said in words: "step 10 skipped: the profile has
no `deploy`, the project does not deploy". A step never drops out silently.

Two fields set the shape of the whole loop — read them right away:

- `F parallel` — `worktrees`: every implementer and reviewer has its own worktree; `single`: one
  implementer per project, work in the main checkout, no worktrees.
- `F workflow.finish` — `pr-green-ci`: steps 8–10 (PR, merge, production); `local-green`: the
  finish is a green step 6, no PR is opened or merged, there is no deploy after a merge — steps
  8–10 are skipped, and that is said.

**Language.** The report to the user and the briefs to agents are in `F language.reports`.
Everything the team sees — commit messages (WIP and `gate:` ones too), the PR title and
description, PR comments (the verdicts `VERIFIED` / `REJECTED` with their list), code comments — is
in `F language.team`. Project documents (ticket files and the ticket's result section, the epic
spec, ADRs, the state file, lessons) are in `F language.docs`; while the profile has no such field
(exit code 4 or `null`), in the language those documents are already written in.

Project pitfalls and special requirements (what the checks leave out, what must change together
with what) are in the profile's `rules.md`: `"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --rules`.
Read it once, before the plan.

## 1. Claim

```bash
<F tickets.epic_status> <epic>              # what is done, what is free
<F tickets.status_tool> claim <epic> <NN>   # writes Status in the spelling the file already uses
```

Without `tickets.epic_status` or `tickets.status_tool` — say that the profile does not track
ticket status, and move it the way the repository's `CLAUDE.md` says.

Read the ticket itself (`F tickets.path`) and the spec next to it (`F tickets.spec`). If the
decision in it is not locked — an ADR first (directory `F docs.adr_dir`; no directory — a question
for the owner), code after; otherwise a rewrite is guaranteed.

One `qmd` call on the ticket's subject (MCP server `qmd`, skill `worfy:qmd`: ADRs, lessons, the
state file, closed tickets, memory; where to expect the answer — `F qmd.collections`, a hint, not a
filter) — before the plan, not after. An accepted decision or a lesson already paid for changes the
plan while it is not yet written.

## 2. Fresh base, own worktree and free numbers

If the profile sets a preflight (`F workflow.preflight`, placeholder `<эпик>`):

```bash
<F workflow.preflight>; echo "EXIT=$?"
```

The last line of the output is `GO` or `BLOCKED: <reasons>`, exit code 1 on `BLOCKED`. What exactly
the command checks and what each reason means is in `rules.md`. The reason "another live session in
the worktree" means the command was run from a shared checkout: with `worktrees`, move to your own
worktree (the `parallel: worktrees` paragraph below) and repeat; with `single` it means another
session works in the checkout — stop and ask the user.
Any other reason — stop, do not work around it. Put the line `<база>: <sha> …` (the base is
`F worktree.base`) into every agent's brief as the base — a subagent that read the local `main`
once reasoned over a stale tree.

Without `workflow.preflight` — say "the profile sets no preflight, running a minimal one" and run:
`git -C <repo> fetch`, `git -C <repo> status --porcelain`, how far behind `F worktree.base` the
checkout is, and with `pr-green-ci` also `gh pr list --state open`. Put the line
`git log -1 --format='%h %s' <base>` into the briefs as the base.

**GitHub account** — `F github.account`. If `gh auth status` shows a different account as active,
do not switch the global one without the owner's permission: other sessions use it. Then every
`gh` command and every `git` command against `origin` runs with
`GH_TOKEN=$(gh auth token -u <F github.account>)`.

**`parallel: worktrees`.** Work from your own worktree from the first minute (`F worktree.implementer`,
where `<ветка>` = `F tickets.branch`, `<имя-тикета>` = `<NN>-<slug>`, and `<эпик>`, `<NN>`, `<slug>`
in the templates come from the ticket; root `F worktree.root`, base `F worktree.base`): the checkout
is shared with other sessions, and the last write wins. Right after `git worktree add` —
`EnterWorktree` with the `path` of that worktree: the PreToolUse check on Edit and Write lets edits
only into the session's worktree, and the agent was started from the orchestrator's worktree. For
an agent, `EnterWorktree` accepts only worktrees under `.claude/worktrees/` of the same repository
— `F worktree.root` must lie there. Edits that go around it through python or sed in Bash are not a
way out.
**`parallel: single`.** No worktree: work in the main checkout, one ticket at a time, on the branch
`F tickets.branch` created from `F worktree.base` (with `local-green` inside a wave — from the
previous ticket's branch, see `/worfy:epic-wave`).

## 3. Take numbers before the content

The step exists only if the profile keeps numbers: `F numbering.adr` or `F numbering.migrations`.
Both `null` or absent — "the project has no ADR or migration numbers, step 3 skipped".

Take the next free number from the output of step 2; do not run it a second time (the preflight's
`ADR:` and `migrations:` lines; details — `rules.md`). If the profile has no preflight, the number
is printed by `F numbering.reserve_with`. Count across all `origin/*` and local branches, not
within one directory. A number is taken with a placeholder at once and the content is written
later: that is how 0039 turned into 0059, when two sessions took the same number.

Migrations — only with `F numbering.migrations.generate`. Order is kept by the field
`F numbering.migrations.order_key` in `F numbering.migrations.journal`, not by the file name; what
happens when two green branches merge and how to fix it — `rules.md`. For reference: a duplicate
ADR number and a broken migration order are caught later by `F numbering.adr.check` and
`F numbering.migrations.check`; do not run them as a separate step here.

## 4. Failing test first

```bash
<F commands.test_one>        # placeholder <файл>
```

Make sure the test is red, and only then fix. What must be running for the tests —
`F commands.requires`; pitfalls of a targeted run — `rules.md`.

## 5. Implementation

Along the files listed in the ticket (section `F tickets.trail_section`; worfy: `## Где в коде`).
Going outside that list is a reason to say so, not to widen the change silently.

## 6. Checks — bare, with the exit code

```bash
<F commands.verify>; echo "EXIT=$?"
```

Filtering long output is required; losing the exit code is not allowed:
`set -o pipefail; <command> | tail -n 30`. The `guard.mjs` hook refuses a pipe without `pipefail` —
that is not nitpicking: this is how a failing linter was once declared clean.
Contract tests are not part of `commands.verify`: if the profile has `F commands.contract`, run it
separately.
Test runners run once only, never in watch mode (vitest — `vitest run`): a watch process never
exits, and the agent hangs.
The gate gives the verdict: `bash "${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh" fast </dev/null; echo "EXIT=$?"`
— always with stdin closed: the script is written for a hook and first drains stdin with `cat`, so
without stdin it hangs forever (that is how ticket 63 stood for ten hours).
Gate exit codes: `0` — green, only if the output has the line `[gate] зелено (…)` (exit code 0
with «ничего не прогналось» (nothing ran) or «окружение недоступно» (the environment is
unavailable) is not a check); `2` — red, fix it; `3` — not verified, neither green nor red: the
line `[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: …` names the reason (project not registered, registry
unreadable, resolver crashed, no node). On exit code 3 do not merge and do not call the ticket
done: the reason goes into the report as "not verified", and a human fixes it.

With `local-green` a green step 6 is the ticket's finish as far as code goes: next are step 7
(review) and step 11 (close), steps 8–10 are skipped.

**Manual GUI checks.** An acceptance item that can only be checked by hand in the GUI is checked
by the agent itself if the OS has granted screen recording and control (macOS: Screen Recording and
Accessibility). Strictly one such agent at a time (in a wave — the brief's "GUI checks" line);
keystrokes only to the app's frontmost process and only after checking that it is frontmost;
screenshots only of the app's window, not the whole screen; do not touch system settings. Launching
"as from Finder" from the agent's shell: `open <app>` passes the agent's environment to the app
(`CLAUDECODE`, `CLAUDE_CODE_*`, `ANTHROPIC_BASE_URL`, the full PATH) — such a launch is not the
same as Finder; launch through `env -i` with the launchd environment (HOME, USER, LOGNAME, SHELL,
TMPDIR, PATH=/usr/bin:/bin:/usr/sbin:/sbin). Several builds with one bundle id on disk — macOS may
open the wrong one (a click on a notification, `open -b`): before the check, verify the process
path (`ps -o comm= -p <pid>`). No permissions, or the check cannot be automated — the item stays
`[ ]` with a line "not verified: <why>" (in the docs' language; worfy: «не проверено: …») in the
ticket's result section: that is an honest gap, not a review finding.

## 7. Review agents on the diff

A WIP commit first: the reviewer's worktree takes only what is committed; it will not see an
uncommitted change and will review old code.

A reviewer is the agent `worfy:reviewer` (`subagent_type: "worfy:reviewer"`), one lens each. The
default lenses are `F review.ticket_lenses` (no field — two or three of `F review.lenses`, by what
the change is about). Two or three in parallel. Each brief gives the path to its worktree (the
agent runs `profile -C <path>`), the lens, the branch and the base.

**`parallel: worktrees`.** Every reviewer has its own worktree; the orchestrator creates it before
the start:

```bash
<F worktree.reviewer>                 # <что-ревьюишь> = <lens>-<NN>, <ветка> — the ticket's branch
(cd <worktree> && <F commands.prepare_tree>)
git worktree remove <worktree>        # after the verdict; a "dirty" refusal means the reviewer left changes — look, no --force
```

Parallel reviewers do not share one worktree: on 16 September two reviewers worked in one, one ran
mutants, the other took a mutant for a flaky test.

**`parallel: single`.** No own worktrees: reviewers read the main checkout, only one of them runs
checks, and only after the implementer has finished.

In both modes mutations only in your own worktree or on copies in your own scratchpad subdirectory
(`<scratchpad>/<agent-name>/`), restored from the copy, not with `git checkout`. Do not run other
agents' scripts from the scratchpad: a reviewer that ran someone else's `mut.sh` hung for three
hours. Contract: findings only, `file:line`, an explicit "found nothing". Re-read every `file:line`
yourself — subagents have quoted lines that were not there.

Each reviewer's brief carries the owner's rules on evidence: an item with "not verified: …" (step
6, manual checks) is not a finding; attached evidence that does not show what is claimed is a
high-severity finding.

**A repeat review after rework** checks the rework round; it does not search everything again. The
brief gives the first round's findings and the diff of the rework only. Only these block: (a) a
first-round finding that is neither fixed nor refuted; (b) a defect introduced by the rework's
changes; (c) a new high-severity defect. Everything else new is `[low] debt: …`: it does not block
and goes to the state file's debts (step 11). Without this rule fresh reviewers always find
something new, and tickets on the critical path get stuck together with their dependents. The
narrow fix round for such a ticket — skill `/worfy:epic-wave`, section 3.

## 8. PR and green CI

Only with `workflow.finish: pr-green-ci`; with `local-green` — "step 8 skipped: the project
finishes on locally green checks".

```bash
gh pr create --fill
gh pr checks <N>                    # a separate command, no pipe
gh pr view <N> --json mergeStateStatus
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

## 9. Merge — a separate step, on green

Only with `pr-green-ci`; the merge is done by whoever `F workflow.merge` names (today always the
orchestrator).

```bash
gh pr merge <N> --squash
```

Status and merge are never joined in one command: the pipe swallows the exit code. When several
waves or workflows run in parallel, a merge and any commit to the main branch go one at a time,
under the shared lock `mkdir <scratchpad>/main.lock` (the command and the rule for a stuck lock —
skill `/worfy:epic-wave`, section 4).

## 10. Check production

Only with `pr-green-ci` and if `F deploy` exists; absent or `null` — "step 10 skipped: the project
does not deploy".

How it deploys — `F deploy.how`. Access to the stand — `F deploy.auth`, the environment variables
needed — `F deploy.env`. The block below runs whole, together with the `sha=` line: shell state does
not persist between calls. Repeat it until the CI run is `completed`:

```bash
sha=$(gh pr view <N> --json mergeCommit --jq .mergeCommit.oid)
<F deploy.ci_run_check>                                          # uses $sha; wait for completed, success
got=$(<F deploy.production_check>); echo "EXIT=$? commit=$got sha=$sha"
```

The expectation is `F deploy.production_expect`: a non-zero `EXIT`, an empty `commit`, or a
`commit` not equal to `$sha` — production is "not verified". Then repeat the smoke tests: where
they are and how to repeat them without running what is forbidden locally — `F deploy.smoke`. The
stand's password never goes into command arguments (it is visible in the process list) — only the
way `F deploy.production_check` passes it. Without an answer from the live address the deploy does
not count as verified.

## 11. Close

```bash
<F tickets.status_tool> done <epic> <NN> --pr <N>     # with local-green — without --pr
```

The state file is `F docs.handoff` (`path`, `kind`, `check`). No field — "the project has no state
file, nothing to update". If it exists, it is the only state file — a snapshot, not a log: at a
phase boundary it is **rewritten**, not appended to. Each item is either still true (update it), or
moves to its place — a lesson where `F lessons` says (`repo:<path>` — into the repository,
`profile` — into the profile's `lessons/`), the story of what was done into the PR description
(with `local-green` — into the commit message) and the ticket, the owner's answer into an ADR or
the ticket — or is deleted. `F docs.handoff.check` checks the form — run it before push; what
exactly it requires — `rules.md`. Do not touch ADRs: they are immutable.

## When to stop

A disputed decision in the spec, a conflict that cannot be resolved mechanically, and red CI (or a
red local check with `local-green`) that has not been fixed in two attempts — these are a stop with
a question, not a guess. Call what is unverified unverified.
