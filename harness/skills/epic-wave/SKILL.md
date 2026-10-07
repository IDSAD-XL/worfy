---
name: epic-wave
description: Run a wave of an epic's tickets — "tickets NN, NN of epic X" (the worfy Autopilot command, `/worfy:epic-wave tickets 05, 06 of epic X`); the older forms "Ticket-ы NN, NN эпика X" (Autopilot before the plugin), "волна N эпика X", "run wave N of epic X" and the request "прогони волну N эпика X"; resuming a wave after a session break. Works in any registered project; commands, paths, deploy and merge order come from the project profile (`${CLAUDE_PLUGIN_ROOT}/bin/profile`).
---

# Run a wave of an epic

`/worfy:ship-ticket` carries one ticket; this skill does the dispatch, the gate and the merge. A
wave is the tickets of one epic that do not block each other; implementer agents write the code.

Everything project-specific comes from the project profile (contract:
`${CLAUDE_PLUGIN_ROOT}/profiles/README.md`). Below, `<repo>` is the project root; `F <field>` is
short for `"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field <field>`.

**Harness paths in profile values.** A profile value that starts with `~/.claude/bin/` is read as `${CLAUDE_PLUGIN_ROOT}/bin/` followed by the rest of the value.
Schema-1 profiles may still carry such values; they point into the frozen pre-plugin Harness, so run
the plugin's copy instead. The Harness's own scripts — `ticket`, `epic-status`, `preflight` — are
not profile facts: they are always called from `${CLAUDE_PLUGIN_ROOT}/bin/`. A bare skill name in `workflow.ticket_skill` (`ship-ticket`) means
`/worfy:ship-ticket`. Placeholders inside profile values (`<эпик>` — the epic, `<NN>` — the ticket
number, `<slug>`, `<ветка>` — the branch, `<имя-тикета>` — `<NN>-<slug>`, `<что-ревьюишь>` — what
is reviewed, `<файл>` — a test file) are part of the profile contract: substitute them as written.

## 0. Profile

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --name; echo "EXIT=$?"
```

- `0` — work by the profile.
- `3` — the project is not registered or has no profile. **Stop**: tell the user "project <repo>
  is not registered — there is no profile, nothing to run the wave by" and offer to create a
  profile (`${CLAUDE_PLUGIN_ROOT}/profiles/README.md`, the section on a new project). Do not guess
  commands.
- `1`, `2` — the registry or the profile is broken, or the path is wrong: stop, pass the stderr
  message to the user.

A step that depends on a field runs only if the field exists. Exit code 4 or a printed `null` —
the step is skipped, and that is said in words ("production check skipped: the profile has no
`deploy`"), not silently.

**Language.** The report to the user and the briefs to agents are in `F language.reports`.
Everything the team sees — commit messages (WIP and `gate:` ones too), the PR title and
description, PR comments (the verdicts `VERIFIED` / `REJECTED` with their list), code comments — is
in `F language.team`. Project documents (ticket files and the ticket's result section, the epic
spec, ADRs, the state file, lessons) are in `F language.docs`; while the profile has no such field
(exit code 4 or `null`), in the language those documents are already written in.

Two fields set the shape of the wave:

- `F parallel` — `worktrees`: implementers run in parallel, each in its own worktree; `single`:
  the wave's tickets go **one at a time** in the main checkout `<repo>` — the next implementer
  starts when the previous ticket has passed the gate (section 3) and, with `pr-green-ci`, has been
  merged (section 4, items 1–2: the merge happens inside the per-ticket loop, while the production
  check and the documents happen once at the end). No worktrees are created.
- `F workflow.finish` — `pr-green-ci`: PR, CI, merge, production; `local-green`: a ticket finishes
  on locally green checks, there is no PR, and section 4 (merge) is skipped entirely except item 4
  (documents). The skill merges nothing: with `single` each next ticket's branch is created from
  the previous ticket's branch (the first from `F worktree.base`), and the documents commit lands on
  the last ticket's branch; when and where to merge that chain is the user's call.

Project pitfalls and what each `BLOCKED` reason of the preflight means are in the profile's
`rules.md` (`"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --rules`); read it once, before the plan.

## 1. Preflight

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/preflight" --epic <epic>; echo "EXIT=$?"
"${CLAUDE_PLUGIN_ROOT}/bin/epic-status" --json | jq '.tickets[] | select(.epic=="<epic>")'
gh pr list --state open --json number,headRefName,mergeStateStatus,files   # pr-green-ci only
```

Preflight: the last line is `GO` or `BLOCKED: <reasons>`, exit code 1 on `BLOCKED`. The line
`<база>: <sha> …` (the base is `F worktree.base`) is the base for the dispatch briefs. What it
checks is in `rules.md`. If the preflight cannot run here (exit 2: not a git repository, for
example the common directory above a multi-repository project) — say "preflight cannot run here,
running a minimal one" and run `git -C <repo> fetch`, `git -C <repo> status --porcelain` and how far behind
the base the checkout is; the briefs' base is then `git log -1 --format='%h %s' <base>`. `gh pr list`
with `files` is needed separately: files under `F numbering.adr.dir` in other PRs are taken numbers.

The GitHub account is `F github.account`. If `gh auth status` shows a different account as
active, do not switch the global account without the owner's permission: other sessions use it.
Then every `gh` command and every `git` command against `origin` — the orchestrator's and the
agents' (the brief's "GitHub:" line) — runs with `GH_TOKEN=$(gh auth token -u <F github.account>)`.

`epic-status --json` takes no epic name (`epic-status <epic> --json`
prints the human-readable line) and returns `{ref, epics, tickets[]}` across all epics — hence the
filter. `state` takes `open|work|blocked|done|none`; the word "claimed" lives in `statusRaw`. If
`epic-status` refuses — say so and build the ticket list from `F tickets.path` by hand.

Outcomes: `BLOCKED` — stop with a message (the reasons, and which of them are only warnings, are in
`rules.md`); an open PR on the ticket's branch (`F tickets.branch`) — the ticket is resumed (section
"How to resume a wave"), not dispatched again; everything else becomes rows of the plan table.

**What goes into the wave.** The request names the wave in one of these ways, and each is the
owner's permission:
- "tickets NN, NN of epic X" — the worfy Autopilot command, for example
  `/worfy:epic-wave tickets 05, 06, 07, 08 of epic worfy-harness` (the numbers have two digits at
  least and are joined by a comma and a space), and its older form "Ticket-ы NN, NN эпика X" (Autopilot before the plugin, still in old transcripts and
  saved project templates) — exactly the listed tickets; the wave number of the plan does not
  matter. Check that each is `open`, its blockers are `done`, and the tickets share no files in
  their trail section; a ticket that fails the check is not dispatched and is named in the report
  with the reason;
- "волна N эпика X" or "run wave N of epic X" — the tickets of row N of the plan table (the waves
  section of `F tickets.spec`; worfy: «Волны») that are not yet `done`.

The wave takes tickets with `state: "open"`, `blockedParsed: true` and every number in
`blockedNums` in state `done`; with `blockedParsed: false`, fix `Blocked by` first.

One `qmd` call (skill `worfy:qmd`: `vec` as a question, `lex` with word stems, `hyde` as the
expected answer; where to expect the answer — `F qmd.collections`) on the epic's subject — before
the plan: an accepted ADR or a lesson already paid for changes the briefs.

The files a ticket may touch come from its section `F tickets.trail_section` (worfy: `## Где в коде`).
An incomplete list (no test, no entry point, or not what `rules.md` requires for such a change) is
completed before dispatch by the agent `worfy:scout` (the brief gives the path `<repo>`): a map of
the ticket with `file:line`.

The wave plan is a table, and it is also the outcome of the preflight:

| Ticket | Files | ADR / migration | Who |
|---|---|---|---|
| 05 | src/moderation/*.ts, test/moderation.spec.ts | ADR-0061 | impl-05 |
| 07 | web/lots/[id]/page.tsx | — | impl-07 |

Two tickets with a shared file go one after the other: the second starts after the first is
merged (with `single` all of them go one after the other anyway). With the owner's permission the
wave may run not strictly by the table but by dependencies and file overlap: a ticket starts as
soon as the PR of every number in its `blockedNums` is merged (`gh pr view --json state` —
`MERGED`; `done` in the ticket file appears only with the documents commit) and its files do not
overlap with the running tickets; without that permission — by the table. Numbers only if the
profile keeps them (`F numbering.adr`, `F numbering.migrations`; none — the column is "—" and the
line "the project has no numbers"). ADR numbers are handed out in the plan one per ticket, next
after the highest on the base (printed by the preflight, `"${CLAUDE_PLUGIN_ROOT}/bin/preflight"`); the implementer pushes a
placeholder with the taken number in the first minutes, so the claim shows up in `gh pr list` for
other sessions. A number goes to every ticket whose acceptance list (worfy: «Готово, когда»)
requires an accepted ADR (`grep -n '^- \[ \].*ADR' <wave tickets>`), not only to the one that asks
for a number itself: the brief "no number — do not create ADR files" with such an item takes the
ticket out of the wave (worfy-daily, wave 1: ticket 03 and, after it, the whole epic). Migrations
only via `F numbering.migrations.generate` on top of the base. Once the table is ready, dispatch
right away, without waiting for confirmation.

## 2. Dispatch

**Questions for the owner do not stop the wave.** A fork the owner decides, in the middle of a
wave: pick the recommended option and record it in the ticket's result section and in the state
file's list of what waits for the owner (worfy: «Ждёт владельца») as "decided without the owner,
confirm" (in the docs' language; worfy: «решено без владельца, подтвердить»). `AskUserQuestion` —
only when the wave cannot continue without an answer; in a Session without a human (worfy
Autopilot) it is declined automatically.

Agent `worfy:implementer` (`subagent_type: "worfy:implementer"`), name `impl-<NN>`, in the
background: steps `F workflow.implementer_steps` of the skill `F workflow.ticket_skill` up to the
finish `F workflow.finish` (a PR with green CI, or locally green checks); the merge stays with the
orchestrator. The order of work and the report format are set in the agent definition; the brief
does not repeat them.

- `parallel: worktrees` — one agent per ticket, all in one message.
- `parallel: single` — one agent at a time; the next one after the gate (section 3) and, with
  `pr-green-ci`, the merge (section 4, items 1–2) of the previous one.

```
Goal: <one sentence from the ticket>
Repository: <repo>                           # the agent runs profile -C with this path
Ticket: <F tickets.path for NN>; spec: <F tickets.spec>
Worktree: <F worktree.implementer>, <ветка> = <F tickets.branch>, <имя-тикета> = <NN>-<slug>;
        # <эпик>, <NN>, <slug> in the templates come from the ticket (worfy: branch <эпик>/<NN>, worktree <NN>)
        # with single: "main checkout <repo>, no worktree, branch <F tickets.branch>
        #   from the base" (with local-green — from the previous wave ticket's branch)
Base: <base line from the preflight>
Files: <exact list>
Numbers: ADR-<NNNN> — create <F numbering.adr.dir>/<NNNN>-<slug>.md, as a placeholder first;
        migration — <F numbering.migrations.generate> on top of the base      # or "no numbers"
Wave neighbours' files (do not touch): <NN>: <files>; <NN>: <files>
Scratchpad: only your own subdirectory <scratchpad>/impl-<NN>/; do not run other agents' scripts from the scratchpad
Write to ~/.claude: allowed | forbidden   # real Claude Code / Agent SDK writes transcripts to ~/.claude/projects
GitHub: GH_TOKEN=$(gh auth token -u <F github.account>) in every gh command and every git command against origin
        # the line only if the global gh account is someone else's (section 1)
GUI checks: yours | not yours                  # "yours" — to at most one agent of the wave at a time
```

The brief always fills the "Write to ~/.claude" line: running real Claude Code or the Agent SDK in a
test writes transcripts to `~/.claude/projects` even if the ticket's code writes nothing there, and
without an explicit answer the implementer either breaks the ban or silently skips the check. Test
runners run once only, never in watch mode (vitest — `vitest run`): a watch process never exits,
and the agent hangs. Manual GUI checks (rules — skill `/worfy:ship-ticket`, step 6) — at most one
agent at a time across the whole wave: the next agent gets "yours" in the "GUI checks" line only
after the previous one has reported. The verifier's brief (section 3) carries the same
"Scratchpad", "Write to ~/.claude" and "GitHub:" lines: the gate runs tests and `gh` too.

A question instead of a report (a disputed spec, a conflict that cannot be resolved mechanically,
CI or a local check red after two attempts) is resolved by an answer through `SendMessage` to the
same agent.

## 3. Verification gate

For every returned report — agent `worfy:reviewer` (name `verify-<NN>`, lens "implementer's
report", the brief gives the path to the worktree). By then the implementer's worktree is idle and
the verifier is alone in it — so it uses that worktree (with `single` — the main checkout); do not
start a second agent in that worktree, and run mutations only on copies in its own scratchpad
subdirectory (`<scratchpad>/verify-<NN>/`; on 16 September a second reviewer in a shared worktree
took a mutant for a flaky test). Do not run other agents' scripts from the scratchpad: a verifier
that ran someone else's `mut.sh` hung for three hours. The report is a claim; the verifier reads
`not_verified` first and gathers the evidence itself:

```bash
cd <implementer worktree>                                     # the worktree from <F worktree.implementer> or <repo>
git diff --name-only <base>...HEAD                            # compare with files_changed
bash "${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh" fast </dev/null; echo "EXIT=$?"   # green: see below
gh pr checks <N>                                              # pr-green-ci only; a separate command, no pipe
gh pr view <N> --json mergeStateStatus,headRefOid             # pr-green-ci only
```

The gate is green only with `EXIT=0` **and** the line `[gate] зелено (fast): …` in the output:
exit code 0 without it means «ничего не прогналось» (nothing ran) or «окружение недоступно» (the
environment is unavailable), and that is not a check. `EXIT=2` — red. `EXIT=3` — not verified,
neither green nor red: the line `[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: …` names the reason (project not
registered, registry unreadable, resolver crashed, no node). On exit code 3 the ticket is not
merged: the verdict is `REJECTED: gate 3 — <line>`. It does not go back to the implementer and
does not use up a round — it is a broken environment, not broken code: the ticket leaves the wave
as a `blocked` row with that reason, and a human fixes it.
Then the verifier re-reads every `file:line` in `claims`, compares `exit_code` in `commands` with
its own run, and looks for a refutation of the report's strongest sentence (the test passed before
the change too). Owner rules the verifier gets in its brief: an acceptance item that cannot be
automated (a system dialog, an OS notification, a live terminal) may stay `[ ]` with a line
"not verified: <why>" (in the docs' language; worfy: «не проверено: …») in the ticket's result
section — that is not a finding and not a reason for `REJECTED`; attached evidence (a screenshot,
command output) that does not show what is claimed is a high-severity finding.

**UI ticket — screenshots in both themes.** A ticket whose diff changes what is visible on screen
(markup, styles, components, interface texts) is called a UI ticket in the verifier's brief, and
the brief gives the path to the project's design spec if there is one. The verifier builds the
worktree (`F commands.build`), captures every affected screen with Playwright `page.screenshot()`
in the light and the dark theme, puts the screenshots in `<scratchpad>/verify-<NN>/screens/`,
looks at each one itself and compares it with the spec; the answer gives the paths and what each
shows. Details — agent `worfy:reviewer`. A UI ticket without screenshots is a medium-severity
finding, not "not verified": a screenshot can be automated, and the exception for manual GUI checks
does not cover it.

The verdict is the first line of the answer: `VERIFIED` or `REJECTED` with the list of unconfirmed
claims; ≤30 lines, `file:line`. Every verdict is recorded so the round count survives a session
break:

```bash
gh pr comment <N> --body "VERIFIED"            # or "REJECTED: <list>"
gh pr view <N> --json comments --jq '[.comments[].body | select(startswith("REJECTED"))] | length'
```

With `local-green` there is no PR: the verdict is written as an empty commit on the ticket's
branch — it survives a session break just as a PR comment does:

```bash
git -C <implementer worktree> commit --allow-empty -m "gate: VERIFIED"     # or "gate: REJECTED: <list>"
git -C <implementer worktree> log --format=%s <base>..HEAD | grep -c '^gate: REJECTED'
```

`REJECTED` (except `REJECTED: gate 3 …` — see above) goes to the same implementer through
`SendMessage` with that list — exactly one rework round (the exception is the narrow round below),
then the gate again. The same message reminds the implementer: cover every new behaviour of the
rework with a test that turns red on a mutant of that change, and think through races in async
code — rework rounds have introduced defects themselves.

**The second gate round checks the rework round; it does not search everything again.** The
brief gives the first round's `REJECTED` list and the diff of the rework only: `git diff <sha>..HEAD`,
where `<sha>` is the branch HEAD before the rework, already after the rebase (append it to the
`REJECTED` comment too, so it survives a session break). A second-round `REJECTED` is given only
for: (a) a first-round item that is neither fixed nor refuted; (b) a defect introduced by the
rework's changes; (c) a new high-severity defect. Everything else new is `[low] debt: …`: it does
not block, the verdict carries it as a line (`VERIFIED; debt: …`), and the documents commit
(section 4, item 4) moves it into the state file. Without this rule a fresh verifier always finds
something new, and a ticket on the critical path blocks everything that depends on it.

A second `REJECTED` takes the ticket out of the wave: a `blocked` row in the report table,
`ticket block` in the documents PR (section 4, item 4). The exception is the **narrow fix round**:
a ticket on the critical path — it has ≥3 transitively dependent tickets that are not `done` (by
`blockedNums` from `epic-status --json`) — whose confirmed second-round findings are not
high-severity. Sceptic agents confirm them — one `worfy:reviewer` agent per finding, tasked with
refuting it; sceptics only read, and if a refutation needs a run, each gets its own worktree
(`F worktree.reviewer`), not the implementer's. Then — one more rework round on exactly the
findings that stood, and a gate of that round only, on the same three grounds. Narrow-round
verdicts carry a prefix: `NARROW: <findings that stood>` before the rework, then `NARROW: VERIFIED`
or `NARROW: REJECTED: …`; `NARROW: REJECTED` takes the ticket out of the wave. A leaf ticket gets
a narrow round only by the owner's decision. How many tickets stand behind the removed one is
counted from tickets actually removed from the wave, not from those skipped in it as already
merged.
The gate is closed when every ticket of the wave has a verdict.

## 4. Merge by policy

Items 1–3 — only with `pr-green-ci`; with `local-green` — "no merge: the project finishes on
locally green checks", and straight to item 4.

Each step is status and merge as two commands; "no checks reported" is what `gh pr checks` prints
on a conflict, not a value of `mergeStateStatus`:

```bash
gh pr view <N> --json mergeStateStatus   # CLEAN — merge; DIRTY — conflict; BLOCKED, UNSTABLE, BEHIND — wait
gh pr merge <N> --squash
```

Wait for CI with one long command, not frequent polling: an agent has a limited number of turns,
and polling `gh pr checks` twice cut a merge off in the middle of CI. The Bash call has timeout
600000; if it did not finish waiting, repeat the same command:

```bash
sha=$(gh pr view <N> --json headRefOid --jq .headRefOid)
id=$(gh run list --branch <branch> --limit 10 --json databaseId,headSha \
       --jq "[.[] | select(.headSha==\"$sha\")][0].databaseId")
if [ -z "$id" ]; then echo "NO RUN"; else
  set -o pipefail; gh run watch "$id" --exit-status --compact --interval 30 | tail -n 5; echo "EXIT=$?"; fi
```

`NO RUN` is not red CI: the run has not been created yet, or the PR is `DIRTY` and GitHub will not
create one. Look at `mergeStateStatus`; on `DIRTY` a rebase is needed (the paragraph on conflicts
at the end of this section).

**Lock on the main branch.** When several waves or workflows of one project run in parallel, every
merge and every documents commit to the main branch goes one at a time, under a shared lock. Take
it in one Bash call with timeout 600000 (if not taken, repeat), and release it on exit and on error
too:

```bash
L=<orchestrator scratchpad>/main.lock                 # one path for all parallel waves (see below)
until mkdir "$L" 2>/dev/null; do
  m=$(stat -f %m "$L" 2>/dev/null) || continue        # lock released between mkdir and stat; Linux: stat -c %Y
  if [ $(( $(date +%s) - m )) -gt 5400 ]; then rmdir "$L"; fi   # older than 90 min — stuck
  sleep 30
done; echo LOCKED
# rebase on a fresh base → merge or commit → push; then:
rmdir "$L"
```

The orchestrator's scratchpad works when all waves run from one session. Different sessions have
different scratchpads, and locks there do not see each other — then use the repository's shared
path: `$(git -C <repo> rev-parse --git-common-dir)/main.lock`.

1. Ordinary PRs with code — one after another, as `VERIFIED` verdicts arrive.
2. PRs touching paths from `F serial_merge.paths` (migrations, deploy changes) — one at a time, by
   the rule `F serial_merge.rule`. No field — "the profile requires no serial merge".
3. Production check — once, after the last code merge. Only if `F deploy` exists; if not —
   "production check skipped: the project does not deploy". How it deploys — `F deploy.how`; what
   not to run locally and which variables are needed — `F deploy.smoke`, `F deploy.env`:

The block runs whole, together with the `sha=` line: shell state does not persist between calls.
Repeat it until the CI run is `completed`:

```bash
sha=$(gh pr view <N> --json mergeCommit --jq .mergeCommit.oid)
<F deploy.ci_run_check>                                          # uses $sha; wait for completed, success
got=$(<F deploy.production_check>); echo "EXIT=$? commit=$got sha=$sha"
```

The expectation is `F deploy.production_expect`: a non-zero `EXIT`, an empty `commit`, or a
`commit` not equal to `$sha` — production is "not verified", and the report says exactly that. The
staging password never goes into command arguments — only the way `F deploy.production_check`
passes it.

4. The documents PR — last, after production is verified (with `local-green` — a documents commit
   after the last `VERIFIED`). `ticket` edits ticket files in the worktree where it
   runs, so the wave's statuses and one state-file edit per wave go on its branch.
   The state file (`F docs.handoff`: `path`, `kind`, `check`) is rewritten as a snapshot (skill
   `/worfy:ship-ticket`, step 11) and takes the `debt:` lines from the gate verdicts as debts; the
   story of the wave goes into the documents PR description, lessons that generalize go where
   `F lessons` says (with `local-green` the story goes into the documents commit message);
   `F docs.handoff.check` before push. No `docs.handoff` — "the project has no state file".

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/ticket" done <epic> <NN> --pr <N>                  # for each merged ticket; with local-green — without --pr
"${CLAUDE_PLUGIN_ROOT}/bin/ticket" block <epic> <NN> "<reason it was rejected by the gate>"   # for each removed one; the reason in the docs' language
```

A conflict with the base at any step: the implementer rebases onto the base in its own worktree
(regenerate the migration with `F numbering.migrations.generate`, do not resolve it by hand), then
the gate again, then the merge. The next PR is taken after the previous one is merged: CI runs on
the fresh merge commit. CI does not start on a PR in state `DIRTY`, and the wave's documents
commit changes ticket files, so open PRs (of the next wave, of a parallel wave, not yet merged)
become `DIRTY`. So check `mergeStateStatus` and rebase before the rework round and before waiting
for CI, not after.

**Cleanup after the merge.** Once a ticket's PR (and the wave's documents PR) is merged — at once
`git worktree remove <worktree>` and `git branch -D <branch>`; the verifiers' worktrees too. A
worktree stays only for a ticket removed from the wave with an open PR. An old ticket branch in a
live worktree is not litter but a false signal: worfy reads ticket status from worktree branches
too, and `claimed` from a merged branch overrides `done` on main (worfy-daily, wave 6: "3 in work"
after the merge).

## 5. Report

A table for the wave, then the four-line status block. Its labels stay exactly as written —
`— Этап:`, `— Сейчас:`, `— Дальше:`, `— Жду:` — whatever the reports language: worfy reads them
(`src/shared/agent/status-block.ts`); the values are in `F language.reports`. `— Этап:` — the
output of `"${CLAUDE_PLUGIN_ROOT}/bin/epic-status" <epic>` after a fast-forward of the main branch; `— Сейчас:` —
only what the gate and the live address confirmed (with `local-green` or without `deploy` — the
gate); `— Жду:` — a decision on a `blocked` ticket, or "nothing". Re-read every `file:line` from
the verifier's answer yourself before quoting it.

| Ticket | PR | Gate | Rework | Production |
|---|---|---|---|---|
| 07 | #341 | REJECTED → VERIFIED | 1 round | 1a2b3c4 |
| 09 | — | REJECTED ×2 | blocked | — |

The "PR" and "Production" columns are "—" with `local-green` and without `deploy`.

## How to resume a wave

`ticket claim` runs in the implementer's worktree, and the status lives on its branch:
`epic-status` on the local main branch does not see it. The state of the wave is read from
branches, PRs and worktrees (branches — the `F tickets.branch` template with everything after
`<эпик>/` replaced by `*`; below — for `<epic>/<NN>-<slug>` and `<epic>/<NN>`):

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/preflight" --epic <epic>; echo "EXIT=$?"   # or the minimal preflight from section 1
for b in $(git for-each-ref --format='%(refname:short)' "refs/heads/<epic>/*" "refs/remotes/origin/<epic>/*"); do
  "${CLAUDE_PLUGIN_ROOT}/bin/epic-status" --json --ref "$b" | jq -c '.tickets[] | select(.epic=="<epic>" and .state!="open")'
done                                            # or "${CLAUDE_PLUGIN_ROOT}/bin/epic-board" — a snapshot across all branches
ls <F worktree.root>                            # parallel: worktrees only
```

A ticket with `state: "work"` and no worktree (with `single` — no commits on its branch) — the
implementer never started: dispatch it again. A worktree without a PR — the implementer stopped
before step 8: continue `/worfy:ship-ticket` in that worktree. An open PR — the ticket waits for
the gate (section 3); count rework rounds by the PR comments. A merged PR while `state` is not
`done` — the documents PR is still ahead (section 4, item 4).

With `local-green` there is no PR, and the state is read from the `gate:` commits on the ticket's
branch: no last `gate: VERIFIED` — run the gate (section 3); if it is red, the implementer has not
finished — continue `/worfy:ship-ticket` on that branch up to a green step 6. `gate: VERIFIED`
exists but `state` is not `done` — the documents commit is still ahead. Rework rounds — the number
of `gate: REJECTED` commits.

Then — from section 1: the preflight is idempotent.
