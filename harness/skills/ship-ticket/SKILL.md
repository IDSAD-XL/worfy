---
name: ship-ticket
description: Carry one ticket of any registered project from claim to the finish its profile declares — worktree or main checkout, reserved ADR/migration numbers, failing test first, bare verification runs, review agents, then PR + green CI + merge + production check, or locally green checks. Project commands, paths, deploy and numbering come from `${CLAUDE_PLUGIN_ROOT}/bin/profile`. Use when starting or resuming work on a ticket from the project's ticket folder (`tickets.path`, e.g. .scratch/<эпик>/issues/), when running a wave of them, or when reviewing a PR another session or person wrote ("review #237 — low").
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
- `F workflow.finish` — `pr-green-ci`: steps 8–10 (PR, merge, production); `local-green`: no PR,
  no deploy — steps 8–10 are skipped, and that is said; the ticket closes in step 11 when the local
  `gate full` is green and its branch is merged locally into the main branch of its repository.

With `pr-green-ci` a third field says where GitHub CI runs: `F workflow.ci` — `pr` (also when the
field is absent): CI on the PR head, waited for in step 8; `batch` (worfy ADR-0068): CI does not
run on a PR and is not a merge condition, it runs once on the main branch after the wave is merged
(skill `/worfy:epic-wave`, section 4, "Batch CI on the main branch").

**Silent mode** — `F _resolved.mode` prints `silent` (contract: `profiles/README.md`, "Full mode and
Silent mode"). The workflow files — the ticket, the epic spec, the state file, ADRs, the glossary,
lessons, evidence screenshots — live in the Workflow folder `F _resolved.workflow_folder`, not in the
repository: a relative path in `F tickets.path`, `F tickets.spec`, `F docs.handoff`, `F docs.adr_dir`,
`F docs.context` and `F lessons` is taken from that folder. Write them only there; the repository's
own documents are read-only, unless the ticket's goal is a document for the team and it says so. The
branch, commit messages, the PR title, description and comments, and code comments describe the change
itself: no epic name, ticket or ADR number, Workflow folder path, `.scratch` or `HANDOFF`. The guard
refuses commits, branch names and PR texts that carry them; `"${CLAUDE_PLUGIN_ROOT}/bin/silent-check"
-C <repo> <text>` shows them before that. In a project of several repositories the ticket's repository
is its `Repo:` line (a name from `F _resolved.repos`), and `<repo>` below is that repository. Full mode
(`full`) — everything as written below, without these rules.

**Attribution** — `F attribution`. `off` (any mode): no Claude attribution lines in commits and PRs
(`Co-Authored-By: Claude …`, `Generated with [Claude Code]`), even where other instructions add them;
the guard refuses such commits and PR texts. `on` — as usual.

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
"${CLAUDE_PLUGIN_ROOT}/bin/epic-status" <epic>              # what is done, what is free
"${CLAUDE_PLUGIN_ROOT}/bin/ticket" claim <epic> <NN>       # writes `Status: claimed <time>`; an old header — exit 1, run `ticket migrate` first
```

If the project keeps no tickets in this form (`F tickets.path` is `null` or `ticket` refuses) — say
that ticket status is not tracked here, and move it the way the repository's `CLAUDE.md` says.

In Silent mode `ticket` writes into the Workflow folder from any directory of the project, and the
claim names the branch: the branch is chosen in step 2, and the claim is repeated there with
`--branch` (the status line stays one).

Read the ticket itself (`F tickets.path`) and the spec next to it (`F tickets.spec`). If the
decision in it is not locked — an ADR first (directory `F docs.adr_dir`; no directory — a question
for the owner), code after; otherwise a rewrite is guaranteed.

One `qmd` call on the ticket's subject (MCP server `qmd`, skill `worfy:qmd`: ADRs, lessons, the
state file, closed tickets, memory; where to expect the answer — `F qmd.collections`, a hint, not a
filter) — before the plan, not after. An accepted decision or a lesson already paid for changes the
plan while it is not yet written.

## 2. Fresh base, own worktree and free numbers

The preflight is the Harness's own, the same for every project:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/preflight" --epic <epic>; echo "EXIT=$?"
```

The last line of the output is `GO` or `BLOCKED: <reasons>`, exit code 1 on `BLOCKED`. What exactly
the command checks and what each reason means is in `rules.md`. The reason "another live session in
the worktree" means the command was run from a shared checkout: with `worktrees`, move to your own
worktree (the `parallel: worktrees` paragraph below) and repeat; with `single` it means another
session works in the checkout — stop and ask the user.
Any other reason — stop, do not work around it. Put the line `<база>: <sha> …` (the base is
`F worktree.base`) into every agent's brief as the base — a subagent that read the local `main`
once reasoned over a stale tree.

If the preflight cannot run here (exit 2: not a git repository, for example the common directory
above a multi-repository project) — say "preflight cannot run here, running a minimal one" and run:
`git -C <repo> fetch`, `git -C <repo> status --porcelain`, how far behind `F worktree.base` the
checkout is, and with `pr-green-ci` also `gh pr list --state open`. Put the line
`git log -1 --format='%h %s' <base>` into the briefs as the base.

**GitHub account** — `F github.account`. `GH_TOKEN` of that account is set by the plugin's
`SessionStart` hook (`hooks/gh-token-env.sh`) for every Bash command of the session and of its
agents; do not switch the global account without the owner's permission: other sessions use it.
If `gh` answers "Could not resolve to a Repository", compare `gh auth status` with
`F github.account` and say so in the report.

**Silent mode branch.** There is no `F tickets.branch` template: the branch is named by what the
change does, checked and recorded in the ticket before the worktree is created:

```bash
b=<kind>/<what-the-change-does>        # fix/lot-withdraw-button — no epic name, ticket or ADR number
if "${CLAUDE_PLUGIN_ROOT}/bin/silent-check" -C <repo> "$b"; then          # prints the traces it finds
  (cd <repo> && "${CLAUDE_PLUGIN_ROOT}/bin/ticket" claim <epic> <NN> --branch "$b"); echo "EXIT=$?"   # Status and Branch: in the Workflow folder
else echo "RENAME: the branch name carries a trace of the workflow"; fi
```

`<ветка>` in the templates below is then `$b`.

**`parallel: worktrees`.** Work from your own worktree from the first minute (`F worktree.implementer`,
where `<ветка>` = `F tickets.branch` (Silent mode: the branch above), `<имя-тикета>` = `<NN>-<slug>`, and `<эпик>`, `<NN>`, `<slug>`
in the templates come from the ticket; root `F worktree.root`, base `F worktree.base`): the checkout
is shared with other sessions, and the last write wins. Right after `git worktree add` —
`EnterWorktree` with the `path` of that worktree: the PreToolUse check on Edit and Write lets edits
only into the session's worktree, and the agent was started from the orchestrator's worktree. For
an agent, `EnterWorktree` accepts only worktrees under `.claude/worktrees/` of the same repository
— `F worktree.root` must lie there. A root outside the repository (`<HARNESS_HOME>/worktrees/<project>/`)
is not supported until worfy-harness ticket 24: the plugin registers no `WorktreeCreate` hook, and
`hooks/worktree-create.sh` is an unregistered draft that was never probed through the plugin. Edits
that go around it through python or sed in Bash are not a way out.
**`parallel: single`.** No worktree: work in the main checkout, one ticket at a time, on the branch
`F tickets.branch` created from `F worktree.base` (with `local-green` — from the main branch after the
previous ticket's local merge, step 11; see `/worfy:epic-wave`).

## 3. Take numbers before the content

The step exists only if the profile keeps numbers: `F numbering.adr` or `F numbering.migrations`.
Both `null` or absent — "the project has no ADR or migration numbers, step 3 skipped".

Take the next free number from the output of step 2; do not run it a second time (the preflight's
`ADR:` and `migrations:` lines; details — `rules.md`). If the preflight could not run, the number
is printed by `"${CLAUDE_PLUGIN_ROOT}/bin/preflight"` from a repository checkout. Count across all `origin/*` and local branches, not
within one directory. A number is taken with a placeholder at once and the content is written
later: that is how 0039 turned into 0059, when two sessions took the same number. In Silent mode the
ADRs are files of the Workflow folder, in no branch: the preflight counts them there, and the
placeholder is a file in the Workflow folder's ADR directory, not a commit in the repository.

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

The change is the smallest one that does the whole ticket. It comes after step 4 — the failing test
stays first — and it never drops an item of the ticket's list of what "done" means.
- Before the edit, list every place the change has to reach: callers, tests, fixtures,
  configuration, exports.
- For a bug, grep every caller of the function you change and fix the cause once, in the shared
  code.
- Then take the first of these options that solves the whole task:
  1. Nothing: the task does not need this code.
  2. Code the repository already has — a helper, a component, a pattern; use it the way the code around it does.
  3. The standard library or a feature of the platform.
  4. A dependency the project already installs; a new dependency for a few lines is not an option.
  5. One line that a reader understands at a glance.
  6. The least new code that works.
- Never cut, whatever the size of the change: checks of input at a trust boundary, error handling
  that keeps data from being lost, security, accessibility, anything the ticket asks for.
- A simplification with a known limit gets a comment in the comment syntax of the language:
  `shortcut: <limit>, <when to redo>` — what the simple code does not handle, then the condition
  under which it has to be replaced. A comment without the part after the comma is incomplete:
  nobody will know when to redo the code. `"${CLAUDE_PLUGIN_ROOT}/bin/shortcut-ledger"` lists the
  `shortcut:` comments of a work tree and marks the incomplete ones `no-trigger`.

Source: ponytail, `skills/ponytail/SKILL.md` and `skills/ponytail-debt/SKILL.md`, commit
`9cc65d03aa2da1db7121b912d03596409ee340b8` of `DietrichGebert/ponytail` (tag v5.1.0) — the order of
options, the list of places before the edit, the rule for a bug, what is never cut, the
`shortcut:` comment and the `no-trigger` mark. The rules are reworded; the marker `shortcut:` and
the mark `no-trigger` are taken as they are. The order of options follows the source closely, so
its licence goes with it — `LICENSE` of the source at that commit:

```text
MIT License

Copyright (c) 2026 DietrichGebert

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

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
The gate gives the verdict: `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null; echo "EXIT=$?"`
— always with stdin closed: the script is written for a hook and first drains stdin with `cat`, so
without stdin it hangs forever (that is how ticket 63 stood for ten hours).
Gate exit codes: `0` — green, only if the output has the line `[gate] зелено (…)` (exit code 0
with «ничего не прогналось» (nothing ran) or «окружение недоступно» (the environment is
unavailable) is not a check); `2` — red, fix it; `3` — not verified, neither green nor red: the
line `[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: …` names the reason (project not registered, registry
unreadable, resolver crashed). On exit code 3 do not merge and do not call the ticket
done: the reason goes into the report as "not verified", and a human fixes it.

With `local-green` a green step 6 is the ticket's finish as far as code goes: next are step 7
(review) and step 11 (close, with the local merge), steps 8–10 are skipped.

**Manual GUI checks.** An acceptance item that can only be checked by hand in the GUI is checked
by the agent itself if the OS has granted screen recording and control (macOS: Screen Recording and
Accessibility). Strictly one such agent at a time (in a wave — the brief's "GUI checks" line);
keystrokes only to the app's frontmost process and only after checking that it is frontmost;
screenshots only of the app's window, not the whole screen; do not touch system settings.
An agent started from inside an app (an Autopilot or worfy Session) runs as that app's child: an
OS-level capture (`screencapture` and the like) makes macOS ask Screen Recording for the app itself,
and granting it quits and reopens the app, which kills the whole run (worfy-harness, 2026-10-07).
Such agents never capture the screen through the OS: screenshots come only from Playwright
(`page.screenshot`) of their own build, and a native dialog is checked by a test with a stubbed
dialog, not by a picture. Launching
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
uncommitted change and will review old code. In Silent mode its message describes the change, like any
other commit of the repository.

A reviewer is the agent `worfy:reviewer` (`subagent_type: "worfy:reviewer"`), one lens each, all
of a round in parallel. Each brief gives the path to its worktree (the agent runs
`profile -C <path>`), the lens, the branch and the base. How many reviewers a round has is set by
its review depth.

**Review depth.** A scale, like effort: `low`, `medium`, `high`, `max`. It sets how many agents
review a round, with which lenses, how much mutation testing they do and which findings get a
sceptic (one `worfy:reviewer` agent per finding, tasked with refuting it, as in the narrow round of
`/worfy:epic-wave`, section 3). Every round has one depth.

| Depth | Agents | Lenses | Mutation testing | Refute (sceptic agents) | Cost of a round, subagent tokens |
|---|---|---|---|---|---|
| `low` | one reviewer | one: it reads the diff and runs the tests of the change (the first of `F review.ticket_lenses`) | none | none | under 0.5 million (estimate) |
| `medium` | two reviewers | the items of the previous round's report, and the tables already made (cases with inputs and expected results, from an earlier round or from the implementer) checked against the code; in a first round, which has no previous report, the first two of `F review.ticket_lenses` | changed lines only | one sceptic per `high` and `med` finding | 1–2 million (estimate); a round without `high` or `med` findings measured 0.47 million |
| `high` | three or four reviewers | `F review.ticket_lenses` (no field — two or three of `F review.lenses`, by what the change is about); one of them builds its own table of cases on the real code and compares the tests of the change with the main branch on this machine's OS (the change may have been written on another OS); a `security` lens | every code line of the change | one sceptic per finding | 5.3–6.4 million (measured 2026-10-12) |
| `max` | the agents of `high` depth, then those of `/worfy:max-review` | the lenses of `high` depth, then the two lenses of max-review on two models | as at `high` depth | as at `high` depth, then the sceptics of max-review | about 10 million (estimate) |

`max` depth is `high` depth, then `/worfy:max-review` on the whole branch: the round at `high` depth
first, then that skill with its own verdict. `max` depth runs only when the owner asks for it, by an
argument, a word in a message or the profile field. The levels of findings stay `high` / `med` /
`low`; a depth is always written with the word "depth" (`high` depth), so the two scales are not
mixed up. The project's full local check before a merge of code (`rules.md`) is outside the depth
scale: it runs at every depth.

**Which depth.** The first that applies:
1. An argument: `/worfy:ship-ticket <epic> <NN> depth <low|medium|high|max>`. The owner's word in
   a message (`review #237 — low`, in any language) is the same argument; it holds for the round
   the message asks for.
2. The profile: the first review round of the change — `F review.depth.first_round`; a repeat
   review after rework — `F review.depth.later_rounds`.
3. No field (exit 4 or `null`) and no argument — the review of the ticket's own diff stays as it
   was, without a depth: two or three reviewers in parallel, one lens each, by
   `F review.ticket_lenses` (no field — two or three of `F review.lenses`, by what the change is
   about), and a repeat review as described below. The report says so:
   `Review depth: ticket lenses — default: the profile has no review.depth.first_round` (for a
   repeat review — `review.depth.later_rounds`). The defaults `high` depth and `medium` depth are
   only for a PR another session wrote (section "Review of a PR another session wrote").

**What blocks.** What blocks a merge, at every depth: a `high` or `med` finding in the code, or a
gap in the tests that guard a destructive action (a delete, stopping a process, replacing a copy).
The other gaps go as a list into a follow-up ticket. Such a test gap belongs to Act on (below)
whatever its level; the other test gaps go to Consider or Noted.

**Two report lines.** The report of every review round names its depth and what its agents spent:

```
Review depth: <depth> — <where it came from>
Review tokens: <subagent tokens of the round> | not measured
```

`<where it came from>` is `argument`, `owner's word`, `review.depth.<field>` or
`default: the profile has no review.depth.<field>`. The tokens are the sum of the token counts the
finished agents of the round report in their results (reviewers, sceptics, the agents of
max-review); an agent whose result shows no count makes the line `Review tokens: not measured`,
never an estimate. When the round's verdict is written down (a PR comment, a `gate:` commit, a line
in the ticket file), the two lines follow the verdict and its group lines: they are never the first
line, and neither starts with `REJECTED` or `gate:`, so the counts of rounds and worfy's reading of
a PR's verdict stay as they are.

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

**Four groups of findings.** When the reviewers have answered and you have re-read every
`file:line`, sort all their findings into four groups and show the four groups to the user. The
groups are a way to show the findings, not a new scale: the levels `high` / `med` / `low` and the
verdicts `VERIFIED` / `REJECTED` of a wave's gate stay as they are. The level of a finding is its
reviewer's: you do not change it, you may only propose a change to that reviewer (below).
- **Act on** — confirmed `high` and `med` findings; they go to rework. No more than 5: a longer
  list means the selection is weak, so check every item again — is it confirmed, is it one defect
  reported twice. A finding its reviewer stands by is never moved out of Act on to fit the limit:
  if more than 5 remain, say so in the report.
- **Consider** — `med` and `low` findings whose fix is disputable or costs more than it gives; they
  go to the ticket's result section as debts (step 11). A `high` finding never goes here.
- **Noted** — `low` findings that need no fix now and the `[low] debt: …` lines of a repeat review;
  one line each in the ticket's result section.
- **Dismissed** — findings you refuted, each with a one-line reason. Deciding not to fix a finding
  does not refute it: such a `med` or `low` finding belongs to Consider.

No finding is dropped silently: what goes to no other group goes to Dismissed, so the owner sees
what was rejected and can overrule it. An empty group is written as "none".

**You do not take a `high` or `med` finding out of Act on alone.** A `low` finding you sort
yourself. A `high` or `med` finding that you would put into Consider, Noted or Dismissed, or whose
level you think is too high, goes back to the reviewer that raised it: before anything goes to
rework, send that reviewer your reason through `SendMessage`. Its answer decides:
- a finding the reviewer withdraws, or agrees to lower or to set aside, goes to the group it agreed
  to, and its line says "agreed by the reviewer";
- a finding the reviewer insists on stays in Act on, at the reviewer's level;
- if the reviewer cannot answer any more, the finding stays in Act on.

Write the Consider, Noted and Dismissed lines into the ticket's result section as soon as they are
sorted, not at step 11: the brief of the repeat review is built from the groups, and a session
break must not lose them.

Source: pstack, `pstack/skills/interrogate/SKILL.md` and
`pstack/skills/interrogate/references/lead-judgment.md`, commit
`ccb5507cec1546dc88135c1139c811e6c59115ba` of `cursor/plugins` (MIT, Copyright (c) 2026 Lauren Tan)
— the four groups, the limit of 5 and the reason to show what was dismissed. The group names are
pstack's; the rules are reworded, not copied. The exchange with the reviewer is this project's own
rule.

**A repeat review after rework** checks the rework round; it does not search everything again. The
brief gives the first round's findings — its Act on group, without the other groups — and the diff
of the rework only. Only these block: (a) a first-round finding that is neither fixed nor refuted;
(b) a defect introduced by the rework's changes; (c) a new high-severity defect. Only the Act on
group counts for (a): what the first round put into Consider, Noted or Dismissed — a `high` or
`med` finding only with its reviewer's agreement — is not ground (a). Everything else new is
`[low] debt: …`: it does not block and goes to the ticket's result section (step 11). Without this
rule fresh reviewers always find
something new, and tickets on the critical path get stuck together with their dependents. The
narrow fix round for such a ticket — skill `/worfy:epic-wave`, section 3.

## 8. PR and green CI

Only with `workflow.finish: pr-green-ci`; with `local-green` — "step 8 skipped: the project
finishes on locally green checks".

In Silent mode the PR title and description tell what the change does and why, the way a colleague
would write them: no ticket, epic, ADR or Workflow folder; the story of the ticket goes into its
result section in the Workflow folder. With `F attribution` `off` there is no attribution line.

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

**`F workflow.ci` is `batch`** — skip the CI wait of this step: GitHub CI does not run on the PR,
and `NO RUN` or old red checks are not a reason to hold it. The finish is the PR plus a local gate
fast with exit code 0 (step 6). Instead of `mergeStateStatus` and `gh pr checks` look at
`mergeable`: `CONFLICTING` — rebase onto the base; `MERGEABLE` — done; `UNKNOWN` — GitHub is still
computing it, ask again in a minute.

```bash
gh pr view <N> --json mergeable --jq .mergeable   # with workflow.ci batch, instead of the CI wait
```

With `pr` the step stays as above.

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

The gate the project requires before this merge is `F workflow.merge_gate` — skill
`/worfy:epic-wave`, section 4, "Gate before merge". With `"wave"`, a single ticket outside a wave
is a set of one PR: the same three blocks, with `PRS=(<N>)`.

With `F workflow.ci` `batch` the merge does not wait for CI: the PR merges on its gate when
`mergeable` is `MERGEABLE`. A single ticket outside a wave is a wave of one: after its merge, the
batch CI run on the main branch of skill `/worfy:epic-wave`, section 4, "Batch CI on the main
branch" — dispatch, wait, and the same rule for a red run.

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

**Local finish** — only with `local-green` (contract: `profiles/README.md`, "Local finish"). The
ticket closes when its branch is merged locally into the main branch of its repository and the local
`gate full` is green on exactly what is merged. The main branch is `F worktree.base` without
`origin/`; without it — `default_branch` of this repository in `F layout.repos`, then the branch
`origin/HEAD` points to, then a local `main` or `master`. Never the branch the main checkout stands
on: with `single` that is the ticket branch itself. The steps go in this order, and each has one
doer:

1. **On top of the main branch — the implementer.** If the branch is not on top of the main branch
   (`git merge-base --is-ancestor <main branch> <ticket branch>` — exit 1), the orchestrator sends
   the ticket back through `SendMessage`; the implementer rebases it in its own worktree (with
   `single` — the main checkout), resolves conflicts there (a migration is regenerated with
   `F numbering.migrations.generate`, not merged by hand), runs its checks again and reports — as
   with a `DIRTY` PR.
2. **The gate — the orchestrator.** `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" full </dev/null; echo
   "EXIT=$?"` in the ticket's worktree — `EXIT=0` and the line `[gate] зелено (…)`: this code is
   exactly what the main branch gets. A red gate stops here: no documents, no merge.
3. **The documents and the merge — whoever `F workflow.merge` names (the orchestrator), in one go
   under the lock** of `/worfy:epic-wave`, section 4, one merge at a time. Full mode: first, under the
   lock, `git -C <repo> merge-base --is-ancestor <main branch> <ticket branch>`, where `<main branch>` is
   found in the order given above — the same order as the lines `M=` of the block below — exit 1 sends the
   branch back to the implementer (step 1) before any document is written. Exit 0 — right before the
   block, in the ticket's worktree, `ticket done` (without `--pr`), the ticket's result section, and —
   when this is the wave's last merged ticket — the state file and `ticket block` of the tickets removed
   from the wave; these edits stay uncommitted. The block commits them on the ticket branch only after
   the branch has passed the on-top check, and fast-forwards the main branch right after, so a ticket
   branch that never reached the main branch does not carry `done`. It commits only this epic's
   folder of the tickets root and the state file (`git commit -- <those paths>`): other changes of the
   tree and anything already staged stay out. In Silent mode the block finds nothing to commit (the
   documents are in the Workflow folder), and `ticket done` follows `MERGED=0`. `<repo>` is the
   repository's main checkout, `<ticket worktree>` the ticket's tree (with `single` — `<repo>` itself):

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$1" 2>/dev/null; }
B=<ticket branch>; T=<ticket worktree>; E=<epic>; DOCS_FAILED=
# the documents: this epic's folder and the state file — nothing else of the tree
DOCS=(); r=$(F tickets.root); h=$(F docs.handoff.path)
[ -n "$r" ] && [ "$r" != null ] && [ -e "$T/${r%/}/$E" ] && DOCS+=("${r%/}/$E")
[ -n "$h" ] && [ "$h" != null ] && [ -e "$T/$h" ] && DOCS+=("$h")
M=$(F worktree.base); [ "$M" = null ] && M=
[ -n "$M" ] || M=$(F layout.repos | jq -r --arg r "$(basename "$(cd <repo> && pwd -P)")" '.[$r].default_branch // empty' 2>/dev/null)
[ -n "$M" ] || M=$(git -C <repo> symbolic-ref -q --short refs/remotes/origin/HEAD)
[ -n "$M" ] || for c in main master; do git -C <repo> rev-parse -q --verify "refs/heads/$c" >/dev/null && { M=$c; break; }; done
M=${M#origin/}
W=$(git -C <repo> worktree list --porcelain | awk -v b="branch refs/heads/$M" '/^worktree /{w=substr($0,10)} $0==b{print w}')
if [ -z "$M" ]; then echo "NO MAIN BRANCH: set worktree.base in the profile"
elif [ "$M" = "$B" ]; then echo "SAME BRANCH: $B is the main branch itself, nothing to merge"
elif ! git -C <repo> merge-base --is-ancestor "$M" "$B"; then echo "NOT ON TOP: back to the implementer — rebase $B onto $M"
  # the prepared documents go back to the branch's state: the rebase needs a clean tree, and no commit carries done
  [ "${#DOCS[@]}" -gt 0 ] && git -C "$T" restore -q --source=HEAD --staged --worktree -- "${DOCS[@]}" \
    && echo "DOCS ROLLED BACK in $T: prepare them again after the rebase"
else
  # the documents: only now, on a branch that is on top — then the fast-forward at once
  if [ "${#DOCS[@]}" -gt 0 ] && [ -n "$(git -C "$T" status --porcelain -- "${DOCS[@]}")" ]; then
    git -C "$T" add -A -- "${DOCS[@]}" && git -C "$T" commit -q -m "<documents commit message>" -- "${DOCS[@]}" \
      || { DOCS_FAILED=1; echo "DOCS COMMIT FAILED in $T: $M not moved — fix the cause (hook, signing, user.email), run the block again"; }
  fi
  if [ -n "${DOCS_FAILED:-}" ]; then :
  elif [ -n "$W" ]; then git -C "$W" merge --ff-only --quiet "$B"; else git -C <repo> branch -f "$M" "$B"; fi
fi
[ -z "${DOCS_FAILED:-}" ] && [ -n "$M" ] && [ "$M" != "$B" ] && git -C <repo> merge-base --is-ancestor "$B" "$M"; echo "MERGED=$?"     # 0 — the branch is in the main branch
echo "MAIN=$M"
```

`MERGED=0` is the proof; anything else — the ticket is not done:
- `NOT ON TOP` — the block also rolls the prepared documents back to the branch's state
  (`DOCS ROLLED BACK`): the implementer's rebase needs a clean tree, and the branch must not get `done`.
  After the rebase and a green `gate full` the documents are prepared again.
- `DOCS COMMIT FAILED` (a commit hook, signing, no `user.email`) — the main branch is not moved and
  `MERGED=1`; the documents stay staged in the ticket's worktree. Fix the cause and run the block
  again.
- `NO MAIN BRANCH` or `SAME BRANCH` (`MERGED=1`) — a profile problem, not the ticket's: the block
  commits, merges and rolls back nothing, so the prepared documents stay uncommitted in the ticket's
  worktree. Fix the profile (`F worktree.base`) and run the block again; if the ticket will not be
  merged now, roll them back by hand with the same `git -C "$T" restore -q --source=HEAD --staged
  --worktree -- <documents>` as in `NOT ON TOP`, so no commit of the branch carries `done`.
- A break between the documents commit and the fast-forward, or a fast-forward that failed: the
  branch carries `done` but is not in the main branch. Run the block again — the documents are
  already committed, so it commits nothing a second time and only fast-forwards. A second run after
  `MERGED=0` changes nothing and prints `MERGED=0` again.

Nothing is pushed: the finish is local. With
`single` the main checkout stays on the ticket branch; the next ticket's branch is created from the
main branch. In Silent mode `ticket done` follows now; in Full mode it reached the main branch with
the fast-forward. With `pr-green-ci`:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/ticket" done <epic> <NN> --pr <N>     # with local-green — without --pr (step 3 above)
```

The state file is `F docs.handoff` (`path`, `kind`, `check`). No field — "the project has no state
file, nothing to update". If it exists, it is the only state file — a snapshot for whoever picks
the work up next, not a log: at a phase boundary it is **rewritten**, not appended to. Rewrite only
the lines of your own epic; do not add a block per ticket or per wave. Each item is either still
true (update it), or moves to its place — a lesson where `F lessons` says (`repo:<path>` — into the
repository, `profile` — into the profile's `lessons/`), the story of what was done into the PR
description (with `local-green` — into the commit message) and the ticket's result section, the
owner's answer into an ADR or the ticket — or is deleted. In Silent mode the story goes into the
ticket's result section in the Workflow folder, not into the PR description or the commit message, and
the state file, the lessons and the ADRs are files of the Workflow folder; when it is a git repository
they are committed there locally (`/worfy:epic-wave`, section 4, item 4), without push.

- Low-severity debts from review stay in the ticket's result section; the state file holds one
  line that links there.
- What waits for the owner: one line per item, with a link to its ticket. An item this PR
  finishes is deleted in this PR. An item waiting longer than two weeks becomes a ticket for the
  owner's step and leaves the state file. Keep the list to about ten items.
- A closed epic is one line among the pointers to where the rest lives.

`F docs.handoff.check` checks the form — run it before push, if the profile sets it; what exactly
it requires — `rules.md`. Do not touch ADRs: they are immutable.

## Review of a PR another session wrote

A PR that another session (for example, one on another machine) or another person wrote, which
this session reviews and its orchestrator merges. Its author has carried steps 1–6; this session
does step 7 on the PR and, when the review lets it, steps 8–11. The review edits nothing on the
author's branch: rework goes back to the author as the PR comment with the verdict.

The request: `/worfy:ship-ticket review #<N> depth <low|medium|high|max>`, the depth optional; the
owner's word `review #237 — low` in a message is the same request.

The depth of every round is chosen as in step 7 (argument, then the profile), but without the
field the review of such a PR always has a depth, by what the PR changes
(`gh pr view <N> --json files --jq '.files[].path'`):
- A PR that changes only documents gets no review agents: its check is the local gate and the CI
  rules of `rules.md`.
- A PR that changes only tests and comments gets `medium` depth in its first round (the depth of
  `F review.depth.first_round`, if that is lower).
- A PR that touches any line of code or of a script outside the tests is a PR with code: its first
  round has the depth of `F review.depth.first_round`, `high` depth without the field.
- Every later round has the depth of `F review.depth.later_rounds`, `medium` depth without the field.
- `max` depth only when the owner asks for it.

The reviewers work in their own worktrees on the PR's head (`git -C <repo> fetch origin
<headRefName>`, then `F worktree.reviewer` with `<ветка>` = `origin/<headRefName>`), with the
briefs, the four groups of findings and the exchange with the reviewers of step 7. A repeat round
checks the author's rework the way step 7 says for a repeat review.

What blocks a merge, at every depth: a `high` or `med` finding in the code, or a gap in the tests
that guard a destructive action (a delete, stopping a process, replacing a copy). The other gaps go
as a list into a follow-up ticket.

At most three review rounds per PR, unless a `high` finding remains. After the third round the
`med` findings and the test gaps that are left go as a list into a follow-up ticket instead of a
fourth round, and the PR goes on to its merge; a `high` finding that is left keeps the PR open, and
the next round checks only that finding. The rounds are the verdict comments of the PR:

```bash
gh pr view <N> --json comments --jq '[.comments[].body | select(test("^(VERIFIED|REJECTED)"))] | length'
```

A wave keeps its own count of rounds (`/worfy:epic-wave`, section 3): one rework round and the
narrow round, without this limit.

The verdict is a PR comment, written as in `/worfy:epic-wave`, section 3: the first line
`VERIFIED` or `REJECTED: <Act on>`, then the lines of the other groups, then the two report lines
of step 7:

```
REJECTED: <Act on: the rework list>
Consider: <findings>
Review depth: <depth> — <where it came from>
Review tokens: <subagent tokens of the round> | not measured
```

The project's full local check before merging code (`rules.md`) is outside the depth scale: it
runs before the merge at every depth. The owner's manual acceptance items do not hold the merge:
the PR merges when the review lets it and the full local check is green, and the items go to the
list of what waits for the owner in the state file (`F docs.handoff`). The report to the user is the
verdict, the four groups and the same two report lines.

## When to stop

A disputed decision in the spec, a conflict that cannot be resolved mechanically, and red CI (or a
red local check with `local-green`) that has not been fixed in two attempts — these are a stop with
a question, not a guess. Call what is unverified unverified.
