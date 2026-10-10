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
  starts when the previous ticket has passed the gate (section 3) and has been merged — with
  `pr-green-ci` its PR (section 4, items 1–2), with `local-green` locally (section 4, "Local merge",
  `MERGED=0`). The merge happens inside the per-ticket loop, while the production check and the
  documents happen once at the end. No worktrees are created.
- `F workflow.finish` — `pr-green-ci`: PR, CI, merge, production; `local-green`: there is no PR and
  no production check; a ticket finishes when the local `gate full` is green and its branch is merged
  locally into the main branch of its repository (section 4, "Local merge"). With `single` each next
  ticket's branch is created from the main branch after the previous ticket's local merge.

**Silent mode** — `F _resolved.mode` prints `silent`. The rules are in skill `/worfy:ship-ticket`,
section 0: the workflow files live in the Workflow folder `F _resolved.workflow_folder`, and branches,
commits, PRs and code comments carry no trace of the workflow. For the wave that means: the statuses go
straight into the Workflow folder (`ticket` from any directory), a ticket's branch is the `Branch:` line
of its file, there is no documents PR or documents commit in the repository (section 4, item 4), and in
a project of several repositories each ticket works in the repository of its `Repo:` line (one ticket —
one repository; paths — `F _resolved.repos`). Every brief, verdict and PR comment that reaches the
repository or GitHub follows the same rule; the briefs to agents are not published and may name the
ticket.

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

The GitHub account is `F github.account`. `GH_TOKEN` of that account is set by the plugin's
`SessionStart` hook (`hooks/gh-token-env.sh`) for every Bash command of the session and of its
agents, the agents of workflow scripts included;
do not switch the global account without the owner's permission: other sessions use it.
If `gh` answers "Could not resolve to a Repository", compare `gh auth status` with
`F github.account` and say so in the report.

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

- `parallel: worktrees` — one agent per ticket, all in one message. `F worktree.root` must lie under
  `.claude/worktrees/` of the repository: an implementer subagent edits only in a tree it entered with
  `EnterWorktree`, and that tool reaches nothing else. A root outside the repository
  (`<HARNESS_HOME>/worktrees/<project>/`) is not supported until worfy-harness ticket 24. The plugin registers no `WorktreeCreate` hook (`hooks/worktree-create.sh`
  is an unregistered draft for ticket 24, never probed through the plugin).
- `parallel: single` — one agent at a time; the next one after the gate (section 3) and the merge of
  the previous one: with `pr-green-ci` its PR (section 4, items 1–2), with `local-green` the local
  merge (section 4, "Local merge", `MERGED=0`).

```
Goal: <one sentence from the ticket>
Repository: <repo>                           # the agent runs profile -C with this path
Ticket: <F tickets.path for NN>; spec: <F tickets.spec>
Worktree: <F worktree.implementer>, <ветка> = <F tickets.branch>, <имя-тикета> = <NN>-<slug>;
        # <эпик>, <NN>, <slug> in the templates come from the ticket (worfy: branch <эпик>/<NN>, worktree <NN>)
        # with single: "main checkout <repo>, no worktree, branch <F tickets.branch>
        #   from the base" (with local-green — from the main branch after the previous ticket's local merge)
        # Silent mode: <ветка> is a branch named by the change (ship-ticket, step 2), recorded with
        #   ticket claim <epic> <NN> --branch <ветка>; Repository: the repository of the ticket's Repo: line
Base: <base line from the preflight>
Files: <exact list>
Numbers: ADR-<NNNN> — create <F numbering.adr.dir>/<NNNN>-<slug>.md, as a placeholder first;
        migration — <F numbering.migrations.generate> on top of the base      # or "no numbers"
Wave neighbours' files (do not touch): <NN>: <files>; <NN>: <files>
Scratchpad: only your own subdirectory <scratchpad>/impl-<NN>/; do not run other agents' scripts from the scratchpad
Write to ~/.claude: allowed | forbidden   # real Claude Code / Agent SDK writes transcripts to ~/.claude/projects
GUI checks: yours | not yours                  # "yours" — to at most one agent of the wave at a time
```

The brief always fills the "Write to ~/.claude" line: running real Claude Code or the Agent SDK in a
test writes transcripts to `~/.claude/projects` even if the ticket's code writes nothing there, and
without an explicit answer the implementer either breaks the ban or silently skips the check. Test
runners run once only, never in watch mode (vitest — `vitest run`): a watch process never exits,
and the agent hangs. Manual GUI checks (rules — skill `/worfy:ship-ticket`, step 6) — at most one
agent at a time across the whole wave: the next agent gets "yours" in the "GUI checks" line only
after the previous one has reported. The verifier's brief (section 3) carries the same
"Scratchpad" and "Write to ~/.claude" lines: the gate runs tests and `gh` too.

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

In Silent mode the branch gets no `gate:` commit (it would carry the review into the repository's
history): the verdict is a line at the end of the ticket file in the Workflow folder, under its result
section, in the same words:

```bash
f=$(ls "$(cd <repo> && "${CLAUDE_PLUGIN_ROOT}/bin/ticket" root)"/<epic>/issues/<NN>-*.md)
printf '\n%s\n' "gate: VERIFIED — $(date +%F)" >>"$f"      # or "gate: REJECTED: <list>"
grep -c '^gate: REJECTED' "$f"
```

These counts do not see the narrow round below: its verdicts start with `NARROW:` (with
`local-green` — commits `gate: NARROW: …`, in Silent mode — such lines in the ticket file). A `NARROW:` comment or commit means the ticket has had
its narrow round; the last `NARROW: VERIFIED` or `NARROW: REJECTED` is its verdict.

**Four groups of findings.** Before a verdict is recorded and before a `REJECTED` list goes to the
implementer, re-read every `file:line` in the verifier's answer and sort its findings into four
groups; the wave's report (section 5) shows the four groups of every ticket under its table. The
groups are a way to show the findings, not a new scale: the levels `high` / `med` / `low`, the
verdicts `VERIFIED` / `REJECTED` and the count of rounds stay as they are.
- **Act on** — confirmed `high` and `med` findings; they go to rework. The implementer gets the Act
  on group as the rework list. No more than 5: a longer list means the selection is weak, so check
  every item again — is it confirmed, is its level right, is it one defect reported twice — and
  move what does not hold to another group. A confirmed `high` finding is never moved out of Act on
  to fit the limit: if more than 5 remain after the second check, say so in the report.
- **Consider** — `med` and `low` findings whose fix is disputable or costs more than it gives; the
  documents commit (section 4, item 4) moves them into the ticket's result section: they are debts,
  not rework.
- **Noted** — `low` findings that need no fix now and the `[low] debt: …` lines of a later round;
  one line each in the ticket's result section, by the same commit.
- **Dismissed** — findings you refuted, each with a one-line reason.

No finding is dropped silently: what goes to no other group goes to Dismissed, so the owner sees
what was rejected and can overrule it. An empty group is written as "none". A `REJECTED` whose Act
on group came out empty is a disagreement with the verifier, not a `VERIFIED`: before you record
anything, send the verifier your reasons through `SendMessage` and record the verdict it answers
with; that exchange is not a rework round. The verifier's brief does not change: the verifier does
not sort, it answers in its own format.

Source: pstack, `pstack/skills/interrogate/SKILL.md` and
`pstack/skills/interrogate/references/lead-judgment.md`, commit
`ccb5507cec1546dc88135c1139c811e6c59115ba` of `cursor/plugins` (MIT, Copyright (c) 2026 Lauren Tan)
— the four groups, the limit of 5 and the reason to show what was dismissed. The group names are
pstack's; the rules are reworded, not copied.

`REJECTED` (except `REJECTED: gate 3 …` — see above) goes to the same implementer through
`SendMessage` with the Act on group of its list — exactly one rework round (the exception is the
narrow round below), then the gate again. The same message reminds the implementer: cover every new
behaviour of the rework with a test that turns red on a mutant of that change, and think through
races in async code — rework rounds have introduced defects themselves.

**The second gate round checks the rework round; it does not search everything again.** The
brief gives the first round's `REJECTED` list and the diff of the rework only: `git diff <sha>..HEAD`,
where `<sha>` is the branch HEAD before the rework, already after the rebase (append it to the
`REJECTED` comment too, so it survives a session break). A second-round `REJECTED` is given only
for: (a) a first-round item that is neither fixed nor refuted; (b) a defect introduced by the
rework's changes; (c) a new high-severity defect. Everything else new is `[low] debt: …`: it does
not block, the verdict carries it as a line (`VERIFIED; debt: …`), and the documents commit
(section 4, item 4) moves it into the ticket's result section. Without this rule a fresh verifier always finds
something new, and a ticket on the critical path blocks everything that depends on it.

A second `REJECTED` takes the ticket out of the wave: a `blocked` row in the report table,
`ticket block` in the documents PR (section 4, item 4; with `local-green` — in the wave's documents
commit described there). The exception is the **narrow fix round**:
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

**The narrow round without a human** (worfy Autopilot). What decides is that a question to the
owner is declined automatically (see section 2); the wave then usually came as "tickets NN, NN of
epic X" or its older form "Ticket-ы NN, NN эпика X". Nobody answers, so for a ticket on the
critical path with a second `REJECTED` the rule decides, without a question and without waiting:
- every finding that stood against the sceptics is medium or low, none high — the ticket gets
  exactly one narrow round on those findings;
- otherwise the ticket gets `ticket block` with the reason and a `blocked` row in the report. That
  is the case when a high-severity finding stood (no narrow round), when the narrow round ended in
  `NARROW: REJECTED`, and when the same ticket would need a second narrow round.

A leaf ticket gets no narrow round in Autopilot: `ticket block`, a `blocked` row, and a line in the
state file's list of what waits for the owner: "narrow round for a leaf ticket — the owner's
decision" (in the docs' language; worfy: «узкий круг листовому Ticket-у — решение владельца»). The
critical path, the sceptics, the three grounds of the narrow round's `REJECTED` and the `NARROW: …`
verdicts recorded as above do not change. There is no marker for worfy besides the `NARROW:`
verdicts: its run journal reads them from the PR comments. A session with a human keeps the rule
above as it is.
The gate is closed when every ticket of the wave has a verdict.

## 4. Merge by policy

Items 1–3 — only with `pr-green-ci`; with `local-green` — the local merge below instead of them, then
item 4.

**Local merge** (`local-green`). Every `VERIFIED` ticket is merged into the main branch of its
repository on this machine, one at a time, under the lock below. The steps, their doers and the block
are in skill `/worfy:ship-ticket`, step 11: the implementer puts its branch on top of the main branch
(the rebase is always the implementer's, in its own worktree — the orchestrator sends the branch back
through `SendMessage`, like a `DIRTY` PR); the orchestrator runs `gate full` there — exit code 0 and
the line `[gate] зелено (…)`; only then, under the lock, the ticket's documents are committed on the
ticket branch (Full mode) and the main branch is fast-forwarded to it in the same block, `MERGED=0` is
the proof. A red gate leaves no documents commit. Nothing is pushed.

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

4. The documents PR — last, after production is verified. `ticket` edits ticket files in the worktree
   where it runs, so the wave's statuses and one state-file edit per wave go on its branch.
   With `local-green` there is no documents PR: each ticket's `ticket done` and result section are
   one commit on **its own branch**, made after its green `gate full`, under the lock, by the same
   block that fast-forwards the main branch (`/worfy:ship-ticket`, step 11, step 3). The wave's
   state-file edit and `ticket block` of the removed tickets ride in that commit of the wave's last
   merged ticket — while the wave still has a `VERIFIED` ticket not yet merged. If it has none (the
   last ticket was removed after the others had merged, or every ticket was removed), the wave's
   documents are one commit on the main branch, under the lock: in the tree where the main branch is
   checked out, or, when it is checked out nowhere (`single`), in a temporary worktree of the main
   branch, removed afterwards. `<main branch>` is the `MAIN=` line of the merge block. The temporary
   worktree has a fixed path in the repository's git directory, so a tree left by a session break is
   found and reused instead of being taken for the main checkout:

```bash
M=<main branch>
TMPW="$(git -C <repo> rev-parse --path-format=absolute --git-common-dir)/worfy-wave-docs"
git -C <repo> worktree prune
W=$(git -C <repo> worktree list --porcelain | awk -v b="branch refs/heads/$M" '/^worktree /{w=substr($0,10)} $0==b{print w}')
if [ -z "$W" ]; then git -C <repo> worktree add -q "$TMPW" "$M" && W=$TMPW; fi
[ "$W" = "$TMPW" ] || TMPW=no
echo "TREE=$W"; echo "TEMPORARY=$TMPW"
```

   In `TREE`: `ticket block` for each removed ticket (run from `TREE`), the state file, the result
   sections. Then, still under the lock — the block commits only this epic's folder of the tickets
   root and the state file, and removes the temporary worktree whether the commit worked or not:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$1" 2>/dev/null; }
W=<TREE>; TMPW=<TEMPORARY>; E=<epic>; rc=0
DOCS=(); r=$(F tickets.root); h=$(F docs.handoff.path)
[ -n "$r" ] && [ "$r" != null ] && [ -e "$W/${r%/}/$E" ] && DOCS+=("${r%/}/$E")
[ -n "$h" ] && [ "$h" != null ] && [ -e "$W/$h" ] && DOCS+=("$h")
if [ "${#DOCS[@]}" -gt 0 ] && [ -n "$(git -C "$W" status --porcelain -- "${DOCS[@]}")" ]; then
  git -C "$W" add -A -- "${DOCS[@]}" && git -C "$W" commit -q -m "<wave documents commit message>" -- "${DOCS[@]}"; rc=$?
fi
[ "$rc" -eq 0 ] || echo "WAVE DOCS COMMIT FAILED: fix the cause (hook, signing, user.email), then both blocks again"
[ "$TMPW" = no ] || git -C <repo> worktree remove --force "$TMPW"
echo "EXIT=$rc"
```

   `EXIT=0` — the documents are on the main branch (or there was nothing to commit: a second run).
   `WAVE DOCS COMMIT FAILED` in a temporary worktree discards the prepared documents with the tree:
   prepare them again in the next `TREE`; in the main checkout they stay staged there. (Decided
   without the owner, confirm.) In Silent mode — neither, see the end of this item.
   The state file (`F docs.handoff`: `path`, `kind`, `check`) is a snapshot; its rules are in
   skill `/worfy:ship-ticket`, step 11. The wave rewrites only its own epic's lines: what is in
   progress and what waits for the owner. Do not add a block per wave; the details of the wave
   go into the result sections of its tickets. The `debt:` lines from the gate verdicts go into
   the result section of their ticket; the state file gets one line that links there. A wave that
   closes the epic sorts its debts: those worth doing become tickets of the next epic, the rest
   stay in the result sections. The closed epic leaves the other sections and becomes one line
   among the pointers to where the rest lives. The story of the wave goes into the documents PR
   description, lessons that generalize go where `F lessons` says (with `local-green` the story
   goes into the documents commit message). Run `F docs.handoff.check`, if the profile sets it,
   before push. No `docs.handoff` — "the project has no state file".
   In Silent mode `ticket` has already written the statuses into the Workflow folder, and the state
   file, the result sections and the lessons are files there too: the repository gets no documents
   PR and no documents commit. When the Workflow folder is a git repository of its own, the wave ends
   with a local commit there, without push (the story of the wave is its message):

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$1"; }
W=$(F _resolved.workflow_folder)
if [ "$(git -C "$W" rev-parse --show-toplevel 2>/dev/null)" = "$(cd "$W" && pwd -P)" ]; then
  git -C "$W" add -A . && git -C "$W" commit -q -m "<epic>: wave of tickets <NN>, <NN> — statuses, state file"; echo "EXIT=$?"
else echo "the Workflow folder is not a git repository of its own: the files are saved, nothing to commit"; fi
```


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
`git worktree remove <worktree>` and `git branch -D <branch>`; the verifiers' worktrees too. With
`local-green` the same after `MERGED=0` (`git branch -d <branch>` — the branch, with its documents
commit, is in the main branch by then). A
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
| 11 | #344 | REJECTED ×2 → NARROW: VERIFIED | 1 round + narrow | 5e6f7a8 |

The "PR" and "Production" columns are "—" with `local-green` and without `deploy`. The "Rework"
column shows a narrow round as "+ narrow"; a narrow round that ended in `NARROW: REJECTED` is a
`blocked` row.

## How to resume a wave

In Silent mode the status is one, in the Workflow folder, and a ticket names its branch in the `Branch:`
line: the wave is read from those lines, not from the `<epic>/*` branches. `<repo>` is the main
checkout; a ticket with a `Repo:` line is looked up in that repository:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$1"; }
(cd <repo> && "${CLAUDE_PLUGIN_ROOT}/bin/epic-status" --json) \
  | jq -r '.tickets[] | select(.epic=="<epic>" and .state!="open") | [.num, .state, (.branch // "-"), (.repo // "-")] | @tsv' \
  | while IFS=$'\t' read -r n st b r; do
      d=<repo>; [ "$r" = - ] || d=$(F _resolved.repos | jq -r --arg r "$r" '.[] | select(.name==$r) | .path')
      if [ "$b" = - ]; then w="no Branch: line"
      elif git -C "$d" rev-parse --verify -q "refs/heads/$b" >/dev/null; then w="local branch"
      elif git -C "$d" rev-parse --verify -q "refs/remotes/origin/$b" >/dev/null; then w="on origin only"
      else w="no such branch"; fi
      printf '%s\t%s\t%s\t%s\n' "$n" "$st" "$b" "$w"
    done
```

With `pr-green-ci` the ticket's PR is `gh pr list --head <branch> --state all`; with `local-green` its
verdicts are the `gate:` lines of its file. The rest of this section reads the same, with "the ticket's
branch" meaning that branch. In Full mode:

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
the gate (section 3); count rework rounds by the PR comments. A `NARROW:` comment means the narrow
round has been given; the last `NARROW: VERIFIED` or `NARROW: REJECTED` is the ticket's verdict,
and with no such verdict yet the narrow round's gate is ahead. A merged PR while `state` is not
`done` — the documents PR is still ahead (section 4, item 4).

With `local-green` there is no PR, and the state is read from the `gate:` commits on the ticket's
branch: no last `gate: VERIFIED` — run the gate (section 3); if it is red, the implementer has not
finished — continue `/worfy:ship-ticket` on that branch up to a green step 6. `gate: VERIFIED`
exists but `state` is not `done` — the documents commit on the ticket branch and the local merge are
still ahead (section 4; `git merge-base --is-ancestor <branch> <main branch>` says whether the merge
happened). `state` is `done` on the branch, but `git merge-base --is-ancestor <branch> <main branch>`
gives 1 — the merge is still ahead and the ticket is not closed: the documents commit was made and the
fast-forward did not follow (a session break, a failed merge); run the merge block again (`/worfy:ship-ticket`,
step 11, step 3) — it does not commit the documents a second time. Rework rounds — the number
of `gate: REJECTED` commits. A `gate: NARROW:` commit means the narrow round has been given; the
last `gate: NARROW: VERIFIED` or `gate: NARROW: REJECTED` is the ticket's verdict.

Then — from section 1: the preflight is idempotent.
