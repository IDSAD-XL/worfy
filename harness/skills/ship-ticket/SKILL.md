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

**Step files.** Steps 7 to 11, the review of a PR another session wrote and the parts only some
tickets need (Silent mode, manual GUI checks, the source of step 5) live in files next to this one.
Each line that starts with `Read` names one and says when to read it: read it then, not before — an
agent that never gets there never pays for it. Claude Code spells out the plugin root only in this
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

What each Stage means is in skill `/worfy:epic-wave`, section 0; for this loop:
- Steps 7 and 8 go in the order of the Pipeline. `agent-review` before `ci` — step 7, then step 8,
  as numbered: the PR is opened only after `review success` on the branch's head, from that head.
  `agent-review` after `ci` (the default) — step 8 first (the PR and its CI), then step 7 on the PR's
  head. With no `agent-review` in the Pipeline — step 7 is skipped, and that is said.
- `check` — step 9 merges only while the PR's head carries `check/<name>` `success` or `skipped`.
  With no `check` Stage a platform PR still waits for the other platform's verdict (step 9).
- `human-review` — step 9 waits for the review decision `APPROVED`; `awaiting-merge` — no step 9:
  people merge, and the ticket stays `claimed` with its PR open until they do.
- `deploy` — step 11 closes the ticket only after its merge commit is deployed.

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/silent-mode.md` when `F _resolved.mode` prints `silent`: the rules of Silent mode (workflow files in the Workflow folder, no trace of the workflow in the branch, commits and PR texts) are there. Full mode (`full`) — everything as written below.

**Attribution** — `F attribution`. `off` (any mode): no Claude attribution lines in commits and PRs
(`Co-Authored-By: Claude …`, `Generated with [Claude Code]`), even where other instructions add them;
the guard refuses such commits and PR texts. `on` — as usual.

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

The last line of the output is `GO` or `BLOCKED: <reasons>`, exit code 1 on `BLOCKED`. What exactly
the command checks and what each reason means is in `rules.md`. The reason "another live session in
the worktree" means the command was run from a shared checkout: with `worktrees`, move to your own
worktree (the `parallel: worktrees` paragraph below) and repeat; with `single` it means another
session works in the checkout — stop and ask the user.
Any other reason — stop, do not work around it. Put the line `<base>: <sha> …` (the base is
`F worktree.base`; in a repository without `origin` — the branch that line names) into every agent's brief as the base — a subagent that read the local `main`
once reasoned over a stale tree.

If the preflight cannot run here (exit 2: not a git repository, for example the common directory
above a multi-repository project) — say "preflight cannot run here, running a minimal one" and run:
`git -C <repo> fetch`, `git -C <repo> status --porcelain`, how far behind `F worktree.base` the
checkout is, and with `pr-green-ci` also `gh pr list --state open`. Put the line
`git log -1 --format='%h %s' <base>` into the briefs as the base.

**GitHub account** — `F github.account`. `GH_TOKEN` of that account is set by the plugin's
`SessionStart` hook (`hooks/gh-token-env.mjs`) for every Bash command of the session and of its
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

`<branch>` in the templates below is then `$b`.

**`parallel: worktrees`.** Work from your own worktree from the first minute (`F worktree.implementer`,
where `<branch>` = `F tickets.branch` (Silent mode: the branch above), `<ticket-name>` = `<NN>-<slug>`, and `<epic>`, `<NN>`, `<slug>`
in the templates come from the ticket; root `F worktree.root`, base `F worktree.base`): the checkout
is shared with other sessions, and the last write wins. Right after `git worktree add` —
`EnterWorktree` with the `path` of that worktree: the PreToolUse check on Edit and Write lets edits
only into the session's worktree, and the agent was started from the orchestrator's worktree. For
an agent, `EnterWorktree` accepts only worktrees under `.claude/worktrees/` of the same repository
— `F worktree.root` must lie there. A root outside the repository (`<HARNESS_HOME>/worktrees/<project>/`)
is not supported yet: the plugin registers no `WorktreeCreate` hook, and
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
<F commands.test_one>        # placeholder <file>
```

Make sure the test is red, and only then fix. What must be running for the tests —
`F commands.requires`; pitfalls of a targeted run — `rules.md`.

## 5. Implementation

Along the files listed in the ticket (section `F tickets.trail_section`).
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
stdin. On an open stdin that sends nothing it waits 2 s before it starts, and a signal in those
2 s may leave the verdict of an earlier run in place (the bash gate before it waited on `cat`
forever: a ticket once stood like that for ten hours).
Gate exit codes: `0` — green, only if the output has the line `[gate] green (…)` (exit code 0
with `[gate] nothing ran (…)` or `[gate] not verified — environment unavailable:` is not a
check); `2` — red, fix it; `3` — not verified, neither green nor red: the
line `[gate] not verified: …` names the reason (project not registered, registry
unreadable, resolver crashed); `127` — node is not on PATH and the gate never started; 128 + the
signal number — `129`, `130`, `143`, `149` (SIGHUP, SIGINT, SIGTERM, Ctrl+Break of Windows) — the
gate itself was stopped and this run wrote nothing. On exit code 3, 127, 129, 130, 143 or 149 do
not merge and do not call the ticket done: the work is not verified, the code
goes into the report as "not verified", and on 3 or 127 a human fixes the environment.

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
