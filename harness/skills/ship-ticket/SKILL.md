---
name: ship-ticket
description: Carry one ticket of any registered project from claim to the finish its profile declares — worktree or main checkout, reserved ADR/migration numbers, failing test first, bare verification runs, review agents, then PR + green CI + merge + production check, or locally green checks. Project commands, paths, deploy and numbering come from `${CLAUDE_PLUGIN_ROOT}/bin/profile`. Use when starting or resuming work on a ticket from the project's ticket folder (`tickets.path`, e.g. .scratch/<epic>/issues/), when running a wave of them, or when reviewing a PR another session or person wrote ("review #237 — low").
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
`/worfy:ship-ticket`. Placeholders inside profile values (`<epic>` — the epic, `<NN>` — the ticket
number, `<slug>`, `<branch>` — the branch, `<ticket-name>` — `<NN>-<slug>`, `<review-target>` — what
is reviewed, `<file>` — a test file) are part of the profile contract: substitute them as written.

**Step files.** Steps 7 to 11, the details of steps 2 and 5 (the preflight's answer, where to work,
the smallest change), the review of a PR another session wrote and the parts only some
tickets need (Silent mode, manual GUI checks, the source of step 5) live in files next to this one.
Each line that starts with `Read` names one and says when to read it: read it then, not before, unless another
skill sends you there earlier — an agent that never gets there never pays for it. Claude Code spells out the plugin root only in this
file: in those files, read every `CLAUDE_PLUGIN_ROOT` placeholder as `${CLAUDE_PLUGIN_ROOT}`.

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
field is absent): CI on the PR head, waited for in step 8; `batch`: CI does not
run on a PR and is not a merge condition, it runs once on the main branch after the wave is merged
(skill `/worfy:epic-wave`, section 4, "Batch CI on the main branch").

**The Pipeline** — `F _resolved.pipeline`: the Stages the ticket goes through, in
order; without `workflow.pipeline` in the profile — the default `queued`, `implementing`, `ci`,
`agent-review`, `gate-merge`, `closing`, `done`. Read it right away; the block prints one Stage per
line, a Check with its name (`check windows`):

```bash
set -o pipefail; "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field _resolved.pipeline | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { for (const t of JSON.parse(s)) console.log(t.kind + (t.name ? " " + t.name : "")) })'; echo "EXIT=$?"
```

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/pipeline-stages.md` once step 6 is green, before the step that follows it: how the Stages order steps 7–11.

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/silent-mode.md` when `F _resolved.mode` prints `silent`: the rules of Silent mode (workflow files in the Workflow folder, no trace of the workflow in the branch, commits and PR texts) are there. Full mode (`full`) — everything as written below.

**Attribution** — `F attribution`. `off` (any mode): no Claude attribution lines in commits and PRs
(`Co-Authored-By: Claude …`, `Generated with [Claude Code]`), even where other instructions add them;
the guard refuses such commits and PR texts. `on` — as usual.

**GitHub account** — `F github.account`. `GH_TOKEN` of that account is set by the plugin's
`SessionStart` hook (`hooks/gh-token-env.mjs`) for every Bash command of the session and of its
agents; do not switch the global account without the owner's permission: other sessions use it.
If `gh` answers "Could not resolve to a Repository", compare `gh auth status` with
`F github.account` and say so in the report.

**Language.** The report to the user and the briefs to agents are in `F language.reports`.
Everything the team sees — commit messages (WIP and `gate:` ones too), the PR title and
description, PR comments (the verdicts `VERIFIED` / `REJECTED` with their list), code comments — is
in `F language.team`. Project documents (ticket files and the ticket's result section, the epic
spec, ADRs, the state file, lessons) are in `F language.docs` (`en` when the profile does not set it).

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

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/step-2-preflight.md` right after it: on `BLOCKED` stop, do not work around it; the file holds what the reasons mean, the base line for every brief, and a minimal preflight where it cannot run.

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/step-2-silent-branch.md` in Silent mode, before the worktree: it names the branch by the change and records it in the ticket (several `Repo:` lines: one name in each).

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/step-2-worktree.md` now, before step 3: with `parallel: worktrees` all work is in your own worktree, entered with `EnterWorktree`; with `single`, in the main checkout.

## 3. Take numbers before the content

The step exists only if the profile keeps numbers: `F numbering.adr` or `F numbering.migrations`.
Both `null` or absent — "the project has no ADR or migration numbers, step 3 skipped".

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/step-3-numbers.md` when the profile keeps numbers: where the next free number comes from, the placeholder, and the order of migrations.

## 4. Failing test first

```bash
<F commands.test_one>        # placeholder <file>
```

Make sure the test is red, and only then fix. What must be running for the tests —
`F commands.requires`; pitfalls of a targeted run — `rules.md`.

## 5. Implementation

Along the files listed in the ticket (section `F tickets.trail_section`).
Going outside that list is a reason to say so, not to widen the change silently.

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/step-5-smallest-change.md` before the first edit of the implementation: the change is the smallest one that does the whole ticket, and the file holds the places to list first, the order of options, what is never cut and the `shortcut:` comment.

**Feature pages** — `F docs.feature_pages`. Exit code 4 or `null`: say "feature pages skipped: the
profile has no `docs.feature_pages`". Set, and the change alters behaviour a page in that folder
describes: update that page in this same PR (with `local-green`, on this branch; in Silent mode too),
even if the ticket's file list does not name it. Refactoring and tests that keep the behaviour need
no page edit.

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/step-5-source.md` only to maintain this step: it holds the source of its rules and their licence.

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
— always with stdin closed: the script is written for a hook and first reads the hook's JSON from
stdin.
Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/step-6-gate-codes.md` when the gate gives anything but exit code 0 with the line `[gate] green (…)`: what each exit code means and what to do.

With `local-green` a green step 6 is the ticket's finish as far as code goes: next are step 7
(review) and step 11 (close, with the local merge), steps 8–10 are skipped.

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/step-6-manual-gui-checks.md` before an acceptance item that can only be checked by hand in the GUI, and before any screenshot or app launch for a check: it holds the rules for macOS and Windows — an agent started from inside an app never captures the screen through the OS.

## 7. Review agents on the diff

Only with `agent-review` in the Pipeline (section 0), at its place there: before step 8 when the
Pipeline puts it before `ci`, on the PR's head after step 8 when after.

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/step-7-review.md` at this step and follow it: the step is all there.

## 8. PR and green CI

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/step-8-pr-and-ci.md` at this step and follow it: the step is all there.

## 9. Merge — a separate step, on green

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/step-9-merge.md` at this step and follow it: the step is all there.

## 10. Check production

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/step-10-production.md` at this step and follow it: the step is all there.

## 11. Close

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/step-11-close.md` at this step and follow it: the step is all there.

## Review of a PR another session wrote

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/review-of-another-pr.md` when you review such a PR and follow it: the whole procedure is there.

## When to stop

A disputed decision in the spec, a conflict that cannot be resolved mechanically, and red CI (or a
red local check with `local-green`) that has not been fixed in two attempts — these are a stop with
a question, not a guess. Call what is unverified unverified.
