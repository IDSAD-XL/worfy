---
name: epic-wave
# shortcut: accepts the old Russian token, remove after the next release
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
`/worfy:ship-ticket`. Placeholders inside profile values (`<epic>` — the epic, `<NN>` — the ticket
number, `<slug>`, `<branch>` — the branch, `<ticket-name>` — `<NN>-<slug>`, `<review-target>` — what
is reviewed, `<file>` — a test file) are part of the profile contract: substitute them as written.

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
spec, ADRs, the state file, lessons) are in `F language.docs` (`en` when the profile does not set it).

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
- `F workflow.ci` (with `pr-green-ci`) — `pr`, also when the field is absent: CI on every PR head
  is a merge condition, as everywhere below; `batch`: CI does not run on PRs and is
  not a merge condition — a PR merges on its gate when `mergeable` is `MERGEABLE`, and CI runs once
  on the main branch after the wave is merged (section 4, "Batch CI on the main branch"). Every place
  below that waits for CI on a PR says what changes with `batch`.

**The Pipeline** — `F _resolved.pipeline`: the Stages a ticket goes through, in order.
Without `workflow.pipeline` in the profile it is the default — `queued`, `implementing`, `ci`,
`agent-review`, `gate-merge`, `closing`, `done` — and the wave goes as written below. Read it with
the profile; the block prints one Stage per line, a Check with its name (`check windows`):

```bash
set -o pipefail; "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field _resolved.pipeline | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { for (const t of JSON.parse(s)) console.log(t.kind + (t.name ? " " + t.name : "")) })'; echo "EXIT=$?"
```

`queued`, `implementing`, `ci`, `closing` and `done` change nothing below: CI stays as
`F workflow.ci` says. The other Stages:

- `agent-review` — the review by agents (section 3) runs where the Pipeline puts it. After `ci` (the
  default, worfy): on the PR, as section 3 says. Before `ci` (a project whose PR hands the work to
  people, such as a Silent mode project reviewed by its team): on the ticket's branch, before any PR —
  the brief tells the implementer to stop after its checks (`/worfy:ship-ticket`, step 6) and open no
  PR; the review mark goes on the branch's head (in Full mode the branch is pushed first, without a
  PR: the mark is a commit status); after `review success` the orchestrator asks the implementer
  through `SendMessage` to open the PR from that same head (step 8). No `agent-review` in the Pipeline
  — no review by agents: section 3 is skipped, and the report says so ("no review by agents: the
  Pipeline has no agent-review"); the merge waits for the other Stages only.
- `check` — Check «<name>»: a PR merges only while its head carries the mark `check/<name>` `success`
  or `skipped`, for every Check of the Pipeline (section 4, "Checks before merge"). Which PRs need
  the check is the project's rule (`rules.md`); the wave waits for the mark, not for the rule. With
  no `check` Stage in the Pipeline the platform PRs still wait: those the project's rules send to
  another platform's verdict go into `PLATFORM=(…)` and merge the old way after that verdict
  (section 4, "Gate before merge").
- `human-review`, `awaiting-merge` — people. With `human-review` the wave does not merge a PR before
  its review decision is `APPROVED` (`gh pr view <N> --json reviewDecision`); with `awaiting-merge`
  it never merges: people do. Such a ticket stays `claimed` with its PR open, the wave goes on without
  it, and its report row says whom it waits for (section 5): it is not `blocked`.
- `gate-merge` — the merge by the orchestrator, section 4 (`F workflow.merge`, `F workflow.merge_gate`).
- `deploy` — after the merge the ticket is not closed (`ticket done`) until its merge commit is
  deployed (section 4, "Deploy before close").

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

**The cross-machine gate comes first** (`F cross_machine_gate`). A project may run
on two machines, one of which cannot run the other's gate full. The PRs of the machine with
`F cross_machine_gate.role` `request` that touch shared code carry the label
`F cross_machine_gate.label` (skill `/worfy:ship-ticket`, step 8), and the machine with `serve`
checks and merges them. Exit code 4 or `null` — the project has one machine: say "cross-machine gate
skipped: the profile has no `cross_machine_gate`" and go on with the preflight. Each machine has its
own profile, so the role is that machine's; the label and the section name come from the profile,
never from this text.

With `serve` — before the preflight, run skill `/worfy:gate-queue`: it processes the open PRs with
the label that wait for this machine, one at a time, and merges each or leaves a red report in it.
The pass is written only there. Its table goes into the wave report (section 5); then go on with
the preflight.

With `request` — first a gate full on the fresh base, before any ticket is dispatched: a worktree of
its own on the base, detached, and the gate full of section 4 in it (the screen check, the e2e lock,
`<PR worktree>` — this worktree):

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$@" 2>/dev/null; }
B=$(F worktree.base) && [ "$B" != null ] || B=origin/main   # no worktree.base: the main branch
git -C <repo> fetch && git -C <repo> worktree add --detach <scratchpad>/base-gate "$B"; echo "EXIT=$?"
(cd <scratchpad>/base-gate && <F commands.prepare_tree>); echo "EXIT=$?"
# then the gate full block of section 4 with <PR worktree> = <scratchpad>/base-gate; afterwards:
git -C <repo> worktree remove --force <scratchpad>/base-gate
```

Its verdict line and exit code go into the wave report before the dispatch. Red — **fix the base
first**: no ticket of the wave is dispatched until gate full on the fresh base is green, and the
report names the verdict and what is being fixed. A fix that touches shared code goes by the same
rule: the label and the `F cross_machine_gate.checks_section` section. Green — then this machine's
own PRs with the label: the epic's tickets `blocked` with the reason of skill `/worfy:ship-ticket`,
step 9. For each — only a report by `F github.account` counts (the account the sessions of both
machines run `gh` as; anyone can write a comment that starts the same way), so with no
`github.account` no report is found and the PR waits:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$@" 2>/dev/null; }
sec=$(F cross_machine_gate.checks_section); acct=$(F github.account)
gh pr view <N> --json state,commits,comments --jq "{state, pushed: .commits[-1].committedDate, report: ([.comments[] | select(.author.login == \"$acct\" and (.body | startswith(\"$sec report: \"))) | {at: .createdAt, verdict: (.body | split(\"\n\")[0])}] | last)}"; echo "EXIT=$?"
```

- `MERGED` — the ticket is closed by skill `/worfy:ship-ticket`, step 11 (`ticket done <epic> <NN>
  --pr <N>`, the state file).
- A red report newer than the last push (`report.at` later than `pushed`) — the ticket is back in
  work: `"${CLAUDE_PLUGIN_ROOT}/bin/ticket" open <epic> <NN>`, and it is dispatched with the report as
  its rework list. Its branch is taken from origin anew (`origin/<branch>`, not the old local branch):
  the other machine rebased it.
- Otherwise the PR still waits for the `serve` machine: the ticket stays `blocked`, and the report
  names it with the PR number.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/preflight" --epic <epic>; echo "EXIT=$?"
"${CLAUDE_PLUGIN_ROOT}/bin/epic-status" --json | jq '.tickets[] | select(.epic=="<epic>")'
gh pr list --state open --json number,headRefName,mergeStateStatus,files   # pr-green-ci only
```

Preflight: the last line is `GO` or `BLOCKED: <reasons>`, exit code 1 on `BLOCKED`. The line
`<base>: <sha> …` (the base is `F worktree.base`; in a repository without `origin` — the branch that
line names) is the base for the dispatch briefs. What it
checks is in `rules.md`. If the preflight cannot run here (exit 2: not a git repository, for
example the common directory above a multi-repository project) — say "preflight cannot run here,
running a minimal one" and run `git -C <repo> fetch`, `git -C <repo> status --porcelain` and how far behind
the base the checkout is; the briefs' base is then `git log -1 --format='%h %s' <base>`. `gh pr list`
with `files` is needed separately: files under `F numbering.adr.dir` in other PRs are taken numbers.

The GitHub account is `F github.account`. `GH_TOKEN` of that account is set by the plugin's
`SessionStart` hook (`hooks/gh-token-env.mjs`) for every Bash command of the session and of its
agents, the agents of workflow scripts included;
do not switch the global account without the owner's permission: other sessions use it.
If `gh` answers "Could not resolve to a Repository", compare `gh auth status` with
`F github.account` and say so in the report.

`epic-status --json` takes no epic name (`epic-status <epic> --json`
prints the human-readable line) and returns `{ref, epics, tickets[]}` across all epics — hence the
filter. `state` takes `open|work|blocked|done|none`; the word "claimed" lives in `statusRaw`. If
`epic-status` refuses — say so and build the ticket list from `F tickets.path` by hand.

Outcomes: `BLOCKED` — stop with a message: the wave does not start until the preflight answers `GO`.
`rules.md` says what each reason means and how to clear it (for example, `another live session in the
tree` — move to your own worktree and run the preflight again), but never turns a reason into a warning:
warnings are only the lines that start with `! `. An open PR on the ticket's branch (`F tickets.branch`)
— the ticket is resumed (section "How to resume a wave"), not dispatched again; everything else becomes
rows of the plan table.

**Open PRs of other epics** (`pr-green-ci` only). Another session — on this
machine or on another one — may have an open PR on files of this wave. The block lists the open PRs
whose branch does not match this epic's branch template `F tickets.branch`, one line per file,
`#<N> <branch> <file>`; it filters inside `gh` (`--jq`) and needs no `jq`:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$@" 2>/dev/null; }
# [<]epic[>] is the profile's own placeholder, matched as written; <epic> after it is the wave's epic.
re=$(F tickets.branch | sed -e 's/[<]epic[>]/<epic>/g' -e 's/<NN>/[0-9]+/g' -e 's/<slug>/.+/g')
[ -n "$re" ] || echo "no tickets.branch in the profile: every open PR is listed"
gh pr list --state open --limit 200 --json number,headRefName,files \
  --jq ".[] | select(\"$re\" == \"\" or (.headRefName | test(\"^$re\$\") | not)) | \"#\\(.number) \\(.headRefName) \\(.files[].path)\""; echo "EXIT=$?"
```

Compare these files with the files of the wave's tickets (their section `F tickets.trail_section`). A
ticket that shares a file with such a PR is **not dispatched until that PR is merged** — the same rule
that keeps two tickets with a shared file out of one wave. The plan table and the wave report name the
ticket, the file and the PR number. On one machine the rule means "a PR of another session".

<!-- shortcut: accepts the old Russian token, remove after the next release -->
**What goes into the wave.** The request names the wave in one of these ways, and each is the
owner's permission:
- "tickets NN, NN of epic X" — the worfy Autopilot command, for example
  `/worfy:epic-wave tickets 05, 06, 07, 08 of epic demo` (the numbers have two digits at
  least and are joined by a comma and a space), and its older form "Ticket-ы NN, NN эпика X" (Autopilot before the plugin, still in old transcripts and
  saved project templates) — exactly the listed tickets; the wave number of the plan does not
  matter. Check that each is `open`, its blockers are `done`, and the tickets share no files in
  their trail section; a ticket that fails the check is not dispatched and is named in the report
  with the reason;
- "волна N эпика X" or "run wave N of epic X" — the tickets of row N of the plan table (the waves
  section of `F tickets.spec`) that are not yet `done`.

The wave takes tickets with `state: "open"`, `blockedParsed: true` and every number in
`blockedNums` in state `done`; with `blockedParsed: false`, fix `Blocked by` first.

One `qmd` call (skill `worfy:qmd`: `vec` as a question, `lex` with word stems, `hyde` as the
expected answer; where to expect the answer — `F qmd.collections`) on the epic's subject — before
the plan: an accepted ADR or a lesson already paid for changes the briefs.

The files a ticket may touch come from its section `F tickets.trail_section`.
An incomplete list (no test, no entry point, or not what `rules.md` requires for such a change) is
completed before dispatch by the agent `worfy:scout` (the brief gives the path `<repo>`): a map of
the ticket with `file:line`.

The wave plan is a table, and it is also the outcome of the preflight:

| Ticket | Files | ADR / migration | Who |
|---|---|---|---|
| 05 | src/moderation/*.ts, test/moderation.spec.ts | ADR 0012 | impl-05 |
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
other sessions. A number goes to every ticket whose acceptance list (`F tickets.done_section`)
requires an accepted ADR (`grep -n '^- \[ \].*ADR' <wave tickets>`), not only to the one that asks
for a number itself: the brief "no number — do not create ADR files" with such an item takes the
ticket out of the wave (it once took one ticket and, after it, the whole epic out of a wave). Migrations
only via `F numbering.migrations.generate` on top of the base. Once the table is ready, dispatch
right away, without waiting for confirmation.

**The decision log of a wave without a human** (worfy Autopilot). What decides is the same as for
the narrow round in section 3: a question to the owner is declined automatically; the wave then
usually came as the Autopilot command. After such a wave only the transcript says why a ticket left
the wave or why one PR was merged before another, and nobody reads a transcript. So every decision
made without the owner gets a row in a file of that run, `decisions.tsv`, in the Harness state
folder of the machine, outside the repository. Start the file at the moment that sign shows — with
the plan table when the wave came as the Autopilot command, later when a question is declined only
then — name it once, and write the plan as its first row:

```bash
P=$("${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --name)
if [ -z "$P" ]; then echo "no project name: the decision log is not kept"; else
  LOG=${HARNESS_HOME:-~/.claude/worfy-harness}"/runs/$P/<epic>-wave-$(date -u +%Y%m%dT%H%M%SZ)/decisions.tsv"
  "${CLAUDE_PLUGIN_ROOT}/bin/decision-log" "$LOG" '<decision>' '<why>' '<evidence>'; echo "EXIT=$?"; echo "$LOG"
fi
```

Every later row is the `decision-log` line of that block with the printed path written out in
place of `$LOG`: a shell variable does not live until the next command, and a second `date` would
name another file. The three values stay in single quotes, so the shell hands them to the script
as written: a backquote or a `$` inside a value is neither run nor expanded. An apostrophe inside a
value is written as `'\''`. `decision-log` creates the file with its header and its folders, and
only appends; do not create or edit the file any other way. One row per decision:
- the plan — which tickets go into the wave and in which order — and each ticket that is not
  dispatched, with the reason;
- a fork the owner decides, settled by the recommended option (section 2);
- a finding put into Dismissed (section 3);
- a narrow round given or refused, and a ticket taken out of the wave (section 3);
- the order of the merges when it differs from the plan (section 4).
- With `F workflow.ci` `batch`: the batch CI run dispatched for the main branch, and its result —
  green, red with the failing jobs, or not verified (section 4, "Batch CI on the main branch").

`<decision>` says what was decided and names the ticket; `<why>` is the reason in one sentence;
`<evidence>` is what can be opened or run to check it — a PR comment, a `file:line`, a command with
its exit code — and is left out when there is none. The values are in `F language.reports`. No
secret goes into a row — a token, a password, a key: the same rule as for a profile. A wrong row is
corrected by a new row. If the project name comes out empty, `EXIT` is not 0 or the command is
refused, the wave goes on without the log and the report says that it could not be written. The log
is not a state file: it is not committed, and a resumed wave does not read it — it starts a file of
its own. A session with a human needs no log.

## 2. Dispatch

**Questions for the owner do not stop the wave.** A fork the owner decides, in the middle of a
wave: pick the recommended option and record it in the ticket's result section and in the state
file's list of what waits for the owner as "decided without the owner,
confirm" (in the docs' language). `AskUserQuestion` —
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
  (`<HARNESS_HOME>/worktrees/<project>/`) is not supported yet. The plugin registers no `WorktreeCreate` hook (`hooks/worktree-create.sh`
  is an unregistered draft, never probed through the plugin).
- `parallel: single` — one agent at a time; the next one after the gate (section 3) and the merge of
  the previous one: with `pr-green-ci` its PR (section 4, items 1–2), with `local-green` the local
  merge (section 4, "Local merge", `MERGED=0`).

```
Goal: <one sentence from the ticket>
Repository: <repo>                           # the agent runs profile -C with this path
Ticket: <F tickets.path for NN>; spec: <F tickets.spec>
Worktree: <F worktree.implementer>, <branch> = <F tickets.branch>, <ticket-name> = <NN>-<slug>;
        # <epic>, <NN>, <slug> in the templates come from the ticket (worfy: branch <epic>/<NN>, worktree <NN>)
        # with single: "main checkout <repo>, no worktree, branch <F tickets.branch>
        #   from the base" (with local-green — from the main branch after the previous ticket's local merge)
        # Silent mode: <branch> is a branch named by the change (ship-ticket, step 2), recorded with
        #   ticket claim <epic> <NN> --branch <branch>; Repository: the repository of the ticket's Repo: line
Base: <base line from the preflight>
Files: <exact list>
Numbers: ADR-<NNNN> — create <F numbering.adr.dir>/<NNNN>-<slug>.md, as a placeholder first;
        migration — <F numbering.migrations.generate> on top of the base      # or "no numbers"
Wave neighbours' files (do not touch): <NN>: <files>; <NN>: <files>
Scratchpad: only your own subdirectory <scratchpad>/impl-<NN>/; do not run other agents' scripts from the scratchpad
Write to ~/.claude: allowed | forbidden   # real Claude Code / Agent SDK writes transcripts to ~/.claude/projects
Temporary HOME: yes | no                    # yes — the checks and the gate run with HOME in a temporary folder, by the recipe below
GUI checks: yours | not yours                  # "yours" — to at most one agent of the wave at a time
Browser roles: <the ticket's Roles: line> | Default   # Browser profile names; Default without the field
```

The brief always fills the "Write to ~/.claude" line: running real Claude Code or the Agent SDK in a
test writes transcripts to `~/.claude/projects` even if the ticket's code writes nothing there, and
without an explicit answer the implementer either breaks the ban or silently skips the check. Test
runners run once only, never in watch mode (vitest — `vitest run`): a watch process never exits,
and the agent hangs. Manual GUI checks (rules — skill `/worfy:ship-ticket`, step 6) — at most one
agent at a time across the whole wave: the next agent gets "yours" in the "GUI checks" line only
after the previous one has reported.

**Browser checks** (worfy: a session with the `worfy-browser` MCP tools). The agent checks the
acceptance criteria a person would check in the project's web pages in a Browser, once under each
role (agent `worfy:implementer`, "Browser checks"); the result is the problems found and Playwright
tests for them, not a Browser run in CI. The "Browser roles" line copies the ticket's header field
`Roles:` (for example `Roles: admin, user`) as it is: a role is the name of a Browser profile. A
ticket without the field gets `Default` — one check under the profile named `Default`. Never infer
roles from the ticket's list of what "done" means. An agent in Autopilot sees only the profiles the
user marked "Available to Autopilot", and never signs in: a role it cannot check comes back in its
report's `sign_in_needed`. The agent opens each Browser for its ticket (`browser_open` with
`ticket: "<epic>/<NN>"`, required in Autopilot), so the Browser is in that ticket's Family. Browser
checks are not the manual GUI checks above: they need no person's
screen and no one-agent-at-a-time queue; worfy's limit of Live Browsers bounds them.

The verifier's brief (section 3) carries the same
"Scratchpad", "Write to ~/.claude" and "Temporary HOME" lines: the gate runs tests and `gh` too.

The brief always fills the "Temporary HOME" line too. `yes` when the tests or checks of the ticket
must not touch the real home folder: "Write to ~/.claude" is `forbidden` and the tests may still
write under HOME (a real Claude Code, the Agent SDK, an installer, a tool's cache or config), or the
run must not read the developer's own shell rc files. `no` — the agent runs with its own HOME. With
`yes` the agent runs `<F commands.verify>` and the gate by this recipe (the agents
`worfy:implementer` and `worfy:reviewer` carry the same one):

```bash
H="$(node "${CLAUDE_PLUGIN_ROOT}/hooks/eval-env.cjs" harness-home)"   # the real Harness home, before HOME changes
T="$(mktemp -d)"; TW="$(cd "$T" && { pwd -W 2>/dev/null || pwd; })"   # TW: the folder as Windows names it (Git Bash)
: > "$T/.zshenv"; : > "$T/.zprofile"; : > "$T/.zshrc"   # without them zsh -ilc waits for the new-user prompt
( export HOME="$T" USERPROFILE="$TW"; <commands.verify> ); echo "EXIT=$?"
( export HOME="$T" USERPROFILE="$TW" HARNESS_HOME="$H"; node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null ); echo "EXIT=$?"
```

`H` is the Harness home as the Harness scripts resolve it — `HARNESS_HOME`, else `EVAL_HARNESS_HOME`
of an eval run, else `.claude/worfy-harness` in the home folder — read before HOME changes. Node
takes the home folder from HOME, and on Windows from USERPROFILE, so both point at the temporary
folder; under Git Bash USERPROFILE gets the Windows spelling of it (`pwd -W`). The three empty rc
files keep `zsh -ilc` (a login shell that code and tests start to read the user's environment) from
stopping at the setup prompt that zsh shows a new user when its build ships the new-user script:
without them such a test hangs until its timeout. `HARNESS_HOME` points the gate at the real
registry, `<HARNESS_HOME>/gate/config.json`; without it the gate under a temporary HOME finds no
registry, prints `[gate] not verified: …` (the registry cannot be read) and exits 3. A registry
still in its old place in the home folder is not found under a temporary HOME: give its path in
`CLAUDE_GATE_CONFIG` for that run. An exit 3 of the gate under a temporary HOME without
`HARNESS_HOME` is an error of the run's environment, not of the code: run the gate again by the
recipe, and do not take that exit 3 for the gate's verdict. With `HARNESS_HOME` on the real Harness
home the gate writes its verdict, markers and cache there (`<HARNESS_HOME>/gate/state`), as it does
without a temporary HOME. That write is allowed whatever the brief's line "Write to ~/.claude" says:
it is the Harness home, not the transcripts in `~/.claude/projects`.

A question instead of a report (a disputed spec, a conflict that cannot be resolved mechanically,
CI or a local check red after two attempts) is resolved by an answer through `SendMessage` to the
same agent.

With `agent-review` before `ci` in the Pipeline (section 0) the brief's `Goal:` line ends with "no
PR: stop after step 6 with the branch pushed; the review by agents comes first", and the PR is
asked for through `SendMessage` after `review success`.

## 3. Verification gate

Only with `agent-review` in the Pipeline (section 0); without it this section is skipped and the
report says so. With `agent-review` before `ci` there is no PR yet: the verifier works on the
ticket's branch, the checks of the PR below wait for step 8, and the review mark goes on the
branch's head.

For every returned report — agent `worfy:reviewer` (name `verify-<NN>`, lens "implementer's
report", the brief gives the path to the worktree). By then the implementer's worktree is idle and
the verifier is alone in it — so it uses that worktree (with `single` — the main checkout); do not
start a second agent in that worktree, and run mutations only on copies in its own scratchpad
subdirectory (`<scratchpad>/verify-<NN>/`; on 16 September a second reviewer in a shared worktree
took a mutant for a flaky test). Do not run other agents' scripts from the scratchpad: a verifier
that ran someone else's `mut.sh` hung for three hours. The report is a claim, and the verifier
gathers the evidence itself:

```bash
cd <implementer worktree>                                     # the worktree from <F worktree.implementer> or <repo>
git diff --name-only <base>...HEAD                            # compare with files_changed
node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null; echo "EXIT=$?"  # green: see below
gh pr view <N> --json mergeStateStatus,headRefOid             # pr-green-ci only
```

With "Temporary HOME: yes" in its brief the verifier runs the gate by the recipe of section 2. An
exit 3 of the gate under a temporary HOME without `HARNESS_HOME` is an error of the run's
environment, not of the code: run the gate again by the recipe, and do not take that exit 3 for the
gate's verdict.

CI of the PR (`pr-green-ci` only) is its checks without the agents' marks: `review`, `check/<name>`
and `deploy` are commit statuses too (`"${CLAUDE_PLUGIN_ROOT}/bin/ticket" mark --contexts` prints
their names), and a `review` failure is a verdict, not red CI. Only commit statuses are left out
(an empty `workflow`): a GitHub Actions job named `deploy` is CI. `CI=pass` is green; `CI=fail`,
`CI=pending` and `CI=none` (no CI run yet) are not:

```bash
gh pr checks <N> --json name,bucket,workflow --jq '[.[] | select(.workflow == "" and (.name == "review" or .name == "deploy" or (.name | startswith("check/"))) | not)] | if length == 0 then "CI=none" elif any(.[]; .bucket == "fail" or .bucket == "cancel") then "CI=fail" elif any(.[]; .bucket == "pending") then "CI=pending" else "CI=pass" end'; echo "EXIT=$?"
```

A non-zero `EXIT` with "no checks reported" is `CI=none`: GitHub has created no CI run (a `DIRTY` PR
gets none; `mergeStateStatus` above says which).

With `F workflow.ci` `batch` the verifier skips this CI check: the PR has no CI run, so `CI=none`
is expected, and old red checks are not a finding either. It runs
`gh pr view <N> --json mergeable,headRefOid` instead; `CONFLICTING` goes back to the implementer
for a rebase, like `DIRTY`. The review mark below is set as usual: it is a commit status, not CI.

**The review mark.** The verdict is bound to the commit it was given on: before the
verifier starts, the orchestrator marks the head commit `review pending`; the recorded verdict marks
the same commit — `review success` for `VERIFIED` and `NARROW: VERIFIED`, `review failure` for
`REJECTED`, `NARROW: <findings>` and `NARROW: REJECTED`. A push after the verdict leaves the mark on
the old commit: the new head has none, and the ticket is back on review. In Full mode the mark is a
commit status of the PR (`pr-green-ci`); with `local-green` in Full mode and an `origin` the commit
is not on GitHub, so there is no mark — the `gate:` commit below stays the record. In Silent mode, and
in Full mode with `local-green` in a repository without `origin`, the mark is a file in the Harness
home (`runs/<project>/marks/<epic>-<NN>.json`), never on GitHub: `ticket mark` picks the store
itself. The comment, the commit and the line below stay: the
rounds are counted by them, and people read them.

```bash
sha=$(git -C <implementer worktree> rev-parse HEAD)          # pr-green-ci: the headRefOid above, the same commit
(cd <repo> && "${CLAUDE_PLUGIN_ROOT}/bin/ticket" mark <epic> <NN> review pending --sha "$sha"); echo "EXIT=$?"
# when the verdict is recorded, on the same $sha:
(cd <repo> && "${CLAUDE_PLUGIN_ROOT}/bin/ticket" mark <epic> <NN> review success --sha "$sha"); echo "EXIT=$?"   # REJECTED: review failure
```

A mark that fails (`EXIT=1`: no network, `gh` refused) changes no verdict: say it in the wave report
and set it again later on the same SHA.

The gate is green only with `EXIT=0` **and** the line `[gate] green (fast): …` in the output:
exit code 0 without it means `[gate] nothing ran (…)` or `[gate] not verified — environment
unavailable:`, and that is not a check. `EXIT=2` — red. `EXIT=3` — not verified,
neither green nor red: the line `[gate] not verified: …` names the reason (project not
registered, registry unreadable, resolver crashed). On exit code 3 the ticket is not
merged: the verdict is `REJECTED: gate 3 — <line>`. It does not go back to the implementer and
does not use up a round — it is a broken environment, not broken code: the ticket leaves the wave
as a `blocked` row with that reason, and a human fixes it. `EXIT=127` — node is not on PATH and
the gate never started: the same as exit code 3, with the reason "node not found". 128 + the signal
number — `EXIT=129`, `130`, `143`, `149` (SIGHUP, SIGINT, SIGTERM, Ctrl+Break of Windows) — the gate itself was stopped and this run wrote nothing: that is no
verdict, and the ticket is not merged on it.
Then the verifier checks the report by the lens "implementer's report" of agent `worfy:reviewer`
(section "Lens descriptions" of the agent). Owner rules the verifier gets in its brief: an acceptance item that cannot be
automated (a system dialog, an OS notification, a live terminal) may stay `[ ]` with a line
"not verified: <why>" (in the docs' language) in the ticket's result
section — that is not a finding and not a reason for `REJECTED`; attached evidence (a screenshot,
command output) that does not show what is claimed is a high-severity finding.

**Gate depth.** The gate described here is `low` depth of the review depth scale (`low`, `medium`,
`high`, `max`; the scale and its costs — skill `/worfy:ship-ticket`, step 7). The depth of the
wave's gate is `F review.depth.wave`. An argument overrides it:
`/worfy:epic-wave tickets 05, 06 of epic X depth medium`; the owner's word in the message
(`wave depth medium`, in any language) is the same argument. No field (exit 4 or `null`) — `low` depth, the gate as described above, and the report says so:
"depth low: the profile has no review.depth.wave". Above `low` depth the gate of every ticket gets
more agents next to the verifier; they work like it, each in its own worktree
(`F worktree.reviewer`), and answer the orchestrator:

| Depth | Agents of the gate | Lenses | Mutation testing | Refute (sceptic agents) |
|---|---|---|---|---|
| `low` | the verifier `verify-<NN>` | the implementer's report | the verifier's own choice, on copies | none in the gate; sceptics only in the narrow round |
| `medium` | the verifier and one reviewer | the implementer's report; the items of the previous round and the tables already made (in a first round, the first of `F review.ticket_lenses`) | changed lines only | one sceptic per `high` and `med` finding, before the verdict |
| `high` | the verifier and two or three reviewers | the implementer's report, `F review.ticket_lenses`, its own table of cases on the real code compared with the main branch on this machine's OS, a `security` lens | every code line of the ticket | one sceptic per finding, before the verdict |
| `max` | the agents of `high` depth, then those of `/worfy:max-review` | the lenses of `high` depth, then those of max-review | as at `high` depth | as at `high` depth, then the sceptics of max-review |

`max` depth is `high` depth, then `/worfy:max-review` on the ticket's branch before its merge
(section 4), for every ticket of the wave, not only for one marked `Risk: high`.
A wave depth above `low` is expensive: before the dispatch, say its price — the cost of one round
from the table of `/worfy:ship-ticket`, step 7, times the tickets of the wave (`high` depth is
5.3–6.4 million subagent tokens per ticket and round).

The findings of all the gate's agents go into one sort into the four groups (below). The verdict
is `REJECTED` while Act on is not empty after the exchange with the agents that raised its
findings, and `VERIFIED` only when none of them stands by a finding in Act on. The depth does not
change the count of rounds: one rework round, the second round's three grounds and the narrow round
stay as written below, at every depth. The limit of three review rounds of a PR another session
wrote (`/worfy:ship-ticket`) does not apply in a wave.

What blocks a merge, at every depth: a `high` or `med` finding in the code, or a gap in the tests
that guard a destructive action (a delete, stopping a process, replacing a copy). The other gaps go
as a list into a follow-up ticket. Such a test gap belongs to Act on whatever its level.

**UI ticket — screenshots in both themes.** A ticket whose diff changes what is visible on screen
(markup, styles, components, interface texts) is called a UI ticket in the verifier's brief, and
the brief gives the path to the project's design spec if there is one. The verifier builds the
worktree (`F commands.build`), captures every affected screen with Playwright `page.screenshot()`
in the light and the dark theme, puts the screenshots in `<scratchpad>/verify-<NN>/screens/`,
looks at each one itself and compares it with the spec; the answer gives the paths and what each
shows. Details — agent `worfy:reviewer`. A UI ticket without screenshots is a medium-severity
finding, not "not verified": a screenshot can be automated, and the exception for manual GUI checks
does not cover it.

The verifier's answer starts with its verdict, in the form that lens gives it. Every verdict is
recorded so the round count survives a session break:

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

In Silent mode the ticket's verdict is the last line of the ticket file that starts with `gate:`,
except the `gate: MAX-REVIEW: …` line (section 4), not the last line of the file:
`gate: VERIFIED — <date>`, or after the narrow round `gate: NARROW: VERIFIED` or
`gate: NARROW: REJECTED: …`. The group lines (below) follow the verdict
line of their round with `VERIFIED` too, and the result section goes on below them. Read the verdict
with `grep '^gate:' <ticket file> | grep -v '^gate: MAX-REVIEW:' | tail -n 1`.

**Four groups of findings.** Before a verdict is recorded and before a `REJECTED` list goes to the
implementer, re-read every `file:line` in the verifier's answer and sort its findings into four
groups; the wave's report (section 5) shows the four groups of every ticket under its table. The
groups are a way to show the findings, not a new scale: the levels `high` / `med` / `low`, the
verdicts `VERIFIED` / `REJECTED` and the count of rounds stay as they are. The level of a finding
is the verifier's: you do not change it, you may only propose a change to the verifier (below).
- **Act on** — confirmed `high` and `med` findings; they go to rework. The implementer gets the Act
  on group as the rework list. No more than 5: a longer list means the selection is weak, so check
  every item again — is it confirmed, is it one defect reported twice. A finding the verifier
  stands by is never moved out of Act on to fit the limit: if more than 5 remain, say so in the
  report.
- **Consider** — `med` and `low` findings whose fix is disputable or costs more than it gives; the
  documents commit (section 4, item 4) moves them into the ticket's result section: they are debts,
  not rework. A `high` finding never goes here.
- **Noted** — `low` findings that need no fix now and the `[low] debt: …` lines of a later round;
  one line each in the ticket's result section, by the same commit.
- **Dismissed** — findings you refuted, each with a one-line reason. Deciding not to fix a finding
  does not refute it: such a `med` or `low` finding belongs to Consider.

No finding is dropped silently: what goes to no other group goes to Dismissed, so the owner sees
what was rejected and can overrule it. An empty group is written as "none".

**You do not take a `high` or `med` finding out of Act on alone.** A `low` finding you sort
yourself. A `high` or `med` finding that you would put into Consider, Noted or Dismissed, or whose
level you think is too high, goes back to the verifier first: before the verdict is recorded, send
the verifier your reason for each such finding through `SendMessage`. Its answer decides, finding
by finding:
- a finding the verifier withdraws, or agrees to lower or to set aside, goes to the group it agreed
  to, and its line says "agreed by the verifier";
- a finding the verifier insists on stays in Act on, at the verifier's level;
- if the verifier cannot answer any more, every such finding stays in Act on.

The same exchange is due when a `REJECTED` would leave Act on empty for another reason (its list
holds only `low` findings): ask the verifier which of them block; what it insists on goes to Act
on, whatever its level. The verdict you record is the one the verifier's answer carries, never your
own: `VERIFIED` only when the verifier itself says so. A `REJECTED` that stands therefore has at
least one finding in Act on, and the implementer never gets an empty list. That exchange is not a
rework round. `REJECTED: gate 3 …` is not a disagreement and has no findings to sort: it keeps its
own rule above. The verifier's brief does not change: the verifier does not sort, it answers in its
own format.

**The recorded verdict carries the groups**, so they survive a session break. The first line of a
recorded `REJECTED` holds the Act on group — the rework list — and each other group that is not
empty follows as a line that starts with the group's name:

```
REJECTED: <Act on: the rework list>
Consider: <findings>
Noted: <findings>
Dismissed: <findings, each with its reason>
```

In a PR comment these lines are the comment's body. With `local-green` the first line is the subject
of the `gate: REJECTED: …` commit and the group lines are its body. In Silent mode the group lines
follow the `gate: REJECTED: …` line in the ticket file. No group line starts with `REJECTED` or
`gate:`, so the counts above still count verdicts only.

**The two report lines** close every recorded verdict, `VERIFIED` and `NARROW: …` too: the gate's
depth and what the agents of that round spent. They follow the verdict and its group lines:

```
REJECTED: <Act on: the rework list>
Consider: <findings>
Review depth: <depth> — <where it came from>
Review tokens: <subagent tokens of the round> | not measured
```

`<where it came from>` is `argument`,
`owner's word`, `review.depth.wave` or `default: the profile has no review.depth.wave`. The tokens
are the sum of the token counts the finished agents of the round report in their results (the
verifier, the reviewers, the sceptics); an agent whose result shows no count makes the line
`Review tokens: not measured`, never an estimate. The two lines are never the first line, and
neither starts with `REJECTED` or `gate:`: the counts of rounds and worfy's reading of a PR's
verdict (its first line) do not see them.

Source: pstack, `pstack/skills/interrogate/SKILL.md` and
`pstack/skills/interrogate/references/lead-judgment.md`, commit
`ccb5507cec1546dc88135c1139c811e6c59115ba` of `cursor/plugins` (MIT, Copyright (c) 2026 Lauren Tan)
— the four groups, the limit of 5 and the reason to show what was dismissed. The group names are
pstack's; the rules are reworded, not copied. The exchange with the verifier and the group lines of
the recorded verdict are this project's own rules.

`REJECTED` (except `REJECTED: gate 3 …` — see above) gets exactly one rework round (the exception
is the narrow round below), then the gate again. The round is a new agent `worfy:implementer` with
the rework brief below, on the same branch — not `SendMessage` to the old
implementer: by then it has usually been idle past its prompt cache (5 min), and its first message
re-reads its whole context, often 100k tokens and more, while the brief is a few thousand. The
exception: the old implementer sent its final report less than 5 min before this brief — then
`SendMessage` to it with the same brief; a report time you do not know counts as older.
Otherwise the previous round's worktree is idle and its branch is pushed: remove that worktree
(`git worktree remove <worktree>`, then `git branch -D <branch>`) and launch the new agent with
the Agent parameter `isolation: "worktree"`, which gives it a fresh tree of its own. There it
checks out the branch from origin (`git checkout -B <branch> origin/<branch>`) and rebases first.
Never send it into an existing tree: `EnterWorktree` refuses a subagent started at the repository
root, by `path` and by `name`. Every rework
round of this skill follows this rule: a `REJECTED`, a narrow round, a red check (section 4), the
culprit of a red set (section 4), a reverted PR.

**The rework brief**:

```
Rework: <epic>/<NN>, round <n>
Repository: <repo>
Ticket: <F tickets.path for NN>; spec: <F tickets.spec>
PR: <N>                               # local-green: none
Branch: <branch>
Worktree: your launch tree (isolation "worktree") — git checkout -B <branch> origin/<branch>
Head: <sha>               # the branch HEAD before the rework; the implementer rebases it first
Findings: <the Act on group of the recorded `REJECTED` | the failing tests of the red run>
Verifier report: <the recorded verdict: PR comment URL, gate: commit or ticket file | the run log>
Cover every new behaviour of the rework with a test that turns red on a mutant of that change,
and think through races in async code — rework rounds have introduced defects themselves.
        # plus the Files, Wave neighbours' files, Scratchpad, Write to ~/.claude, Temporary HOME,
        # GUI checks and Browser roles lines of the first brief (section 2)
```

**The second gate round checks the rework round; it does not search everything again.** The
brief gives the first round's list — the Act on group of the recorded `REJECTED`, without the lines
of the other groups — and the diff of the rework only: `git diff <sha>..HEAD`,
where `<sha>` is the head after the rebase the rework starts with, as the implementer names it in
its PR comment (local-green: its report) — not the brief's `Head`, which is from before that
rebase. The PR comment keeps it across a session break. A second-round `REJECTED` is given only
for: (a) a first-round item that is neither fixed nor refuted; (b) a defect introduced by the
rework's changes; (c) a new high-severity defect. Only the items of that list count for (a): what
the first round put into Consider, Noted or Dismissed — a `high` or `med` finding only with the
verifier's agreement — is not ground (a). Everything else new is `[low] debt: …`: it does
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

<!-- shortcut: accepts the old Russian token, remove after the next release -->
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
decision" (in the docs' language). The
critical path, the sceptics, the three grounds of the narrow round's `REJECTED` and the `NARROW: …`
verdicts recorded as above do not change. There is no marker for worfy besides the `NARROW:`
verdicts: its run journal reads them from the PR comments. A session with a human keeps the rule
above as it is.
The gate is closed when every ticket of the wave has a verdict.

## 4. Merge by policy

Items 1–3 — only with `pr-green-ci`; with `local-green` — the local merge below instead of them, then
item 4.

**Max review of a risky ticket.** A ticket whose header has the line `Risk: high` gets
`/worfy:max-review` on its branch before its merge: after its `VERIFIED` of section 3, before items
1–2 or the local merge. It reviews the whole branch with two lenses, each on two models; its rules
are in that skill. Its verdict is `MAX-REVIEW: VERIFIED` or `MAX-REVIEW: REJECTED: <Act on>`, written
where section 3 writes the gate's verdicts, with the prefix: with a PR — a comment in the PR; with
`local-green` — an empty commit `gate: MAX-REVIEW: …` on the ticket's branch; in Silent mode — a line
`gate: MAX-REVIEW: …` at the end of the ticket file. The counts of rework rounds in section 3 do not
see these verdicts, and they do not see the rounds. `MAX-REVIEW: VERIFIED` — the merge goes on as
usual. `MAX-REVIEW: REJECTED` → `ticket block`, without a rework round: the ticket has had its rounds
in section 3. It is not merged, it leaves the wave as a `blocked` row with the reason "max-review
REJECTED" and the PR number, and its Act on group goes into the report and the ticket's result
section; whether to rework or merge it is the owner's decision. Without a human — the same, without a
question and without waiting, plus a line in the state file's list of what waits for the owner:
"max-review REJECTED — the owner's decision". A ticket without the line gets no max review unless the
owner asks for it.

**Local merge** (`local-green`). Every `VERIFIED` ticket is merged into the main branch of its
repository on this machine, one at a time, under the lock below. The steps, their doers and the block
are in skill `/worfy:ship-ticket`, step 11: the implementer puts its branch on top of the main branch
(the rebase is always the implementer's, in its own worktree — the orchestrator sends the branch back
through `SendMessage`, like a `DIRTY` PR); the orchestrator runs `gate full` there — exit code 0 and
the line `[gate] green (…)`; only then, under the lock, the ticket's documents are committed on the
ticket branch (Full mode) and the main branch is fast-forwarded to it in the same block, `MERGED=0` is
the proof. A red gate leaves no documents commit. Nothing is pushed.

Each step is status and merge as two commands; "no checks reported" is what `gh pr checks` prints
on a conflict, not a value of `mergeStateStatus`:

```bash
gh pr view <N> --json mergeStateStatus   # CLEAN — merge; DIRTY — conflict; BEHIND — rebase (below); BLOCKED, UNSTABLE — wait
gh pr merge <N> --squash
```

**Merge in turn across machines**. Another machine may merge into the same
main branch, and nothing here waits for it. Before each merge run `git -C <repo> fetch`. A PR merged outside
`wave-gate` (with `"each"`, or one out of the set) in state `BEHIND`, or whose base moved after its
checks ran, does not wait: nothing will update its branch. Rebase the branch onto the fresh base in the ticket's worktree and push it with a lease
on the head the PR had before the rebase — `git push --force-with-lease=<branch>:<headRefOid> origin
HEAD:<branch>`, `<headRefOid>` from `gh pr view <N> --json headRefOid` — so a push from elsewhere is
not overwritten; then wait for CI again with the CI wait block below (with `F workflow.ci` `batch`: `mergeable` again). `BEHIND` no longer means only
"wait". PRs of a `wave-gate` set are not rebased (below): `wave-gate merge` checks that each merge
gives the tree it checked.

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

With `F workflow.ci` `batch` neither block above applies: there is no CI run to wait for, and
`mergeStateStatus` can stay `UNSTABLE` from checks of an older head. The merge condition is the
gate below plus `mergeable`:

```bash
gh pr view <N> --json mergeable --jq .mergeable   # batch: MERGEABLE — merge; CONFLICTING — rebase; UNKNOWN — ask again
```

**Lock on the main branch.** When several waves or workflows of one project run in parallel, every
merge and every documents commit to the main branch goes one at a time, under a shared lock. Take
it in one Bash call with timeout 600000 (if not taken, repeat), and release it on exit and on error
too:

```bash
L="$(git -C <repo> rev-parse --path-format=absolute --git-common-dir)/main.lock"   # the repository's shared path (see below)
until mkdir "$L" 2>/dev/null; do
  if [ -n "$(find "$L" -maxdepth 0 -mmin +90 2>/dev/null)" ]; then rmdir "$L"; fi   # older than 90 min — stuck; BSD and GNU find alike
  sleep 30
done; echo LOCKED
# rebase on a fresh base → merge or commit → push; then:
rmdir "$L"
```

The path is the repository's shared git folder, the same in every worktree of the repository and
for every session: the waves of one session, a wave of another session, and the merges of skill
`/worfy:gate-queue` all see the same lock. A scratchpad would not do — each session has its own,
and locks there do not see each other. The lock is seen only on its own machine: a session on
another machine does not see it and merges on its own, so the order across machines comes from the
fetch and rebase before each merge (above), not from the lock.

**PRs with the cross-machine label** (`F cross_machine_gate`; exit code 4 or `null` — the project has
one machine, skip this paragraph and say so). With `F cross_machine_gate.role` `request` a PR with the
label `F cross_machine_gate.label` is not merged on this machine, whatever its gate says: in the wave
report it is "waits for the machine with `serve`", with its number. With `serve` such PRs are merged
by skill `/worfy:gate-queue` (section 1), before the wave, not here.

**People in the Pipeline.** With `awaiting-merge` the wave merges no PR, and with `human-review` no PR
whose review decision is not `APPROVED` (section 0): the ticket waits for people, and the wave goes on
without it.

**Checks before merge** (a `check` Stage in the Pipeline, section 0). Before a PR merges — in a set,
the old way or one after another — every Check of the Pipeline has its mark on the PR's head:
`check/<name>` `success` or `skipped`. The orchestrator sets the marks, on the head SHA
(`gh pr view <N> --json headRefOid`):

```bash
(cd <repo> && "${CLAUDE_PLUGIN_ROOT}/bin/ticket" mark <epic> <NN> check/<name> skipped --sha "$sha"); echo "EXIT=$?"   # or pending, success, failure
```

- `skipped` — the project's rules (`rules.md`) say the PR does not need this check.
- `pending` — the PR needs it and the check is asked for. `success` or `failure` — its verdict. A
  check another session runs (worfy: `windows`, the session on the Windows PC) reports the commit it
  checked, the exit code of its gate full and the gate's verdict line: exit code 0 and the line
  `[gate] green (…)` on the PR's head — `success` (a gate of the release before prints the same line
  with a Russian word in place of `green`: the same verdict, for one release); red — `failure`: the PR is not merged and goes
  to a rework round (section 3, a fresh implementer) with that report; "could not verify", or a report on
  another commit — no new mark, and the PR waits.
- A check a CI runner may answer. The project's rules (`rules.md`) may name, for a Check, a scope
  command, a dispatch command (with `$ref` for the branch), the workflow of that dispatch, the job
  whose conclusion is the verdict and the step of that job that runs the tests. No such rules — skip
  this item. For each PR that needs the check (the rules say which), run the scope command on a
  fresh checkout of the main branch — never the PR's branch, so that a PR cannot change its own
  verdict — with the main branch and the PR's head: `git fetch -q origin <main branch> <branch>`,
  then `<scope command> origin/<main branch> "$sha"; echo "EXIT=$?"`.
  - `EXIT=0` — the run answers. Every dispatch is a paid run, and a session break, an earlier wave
    or a lookup that gave up may have left one on this head: look before dispatching.
    1. The mark `check/<name>` on `$sha`, read as the block below reads marks (commit statuses —
       `gh api "repos/{owner}/{repo}/commits/$sha/status" --jq '[.statuses[] | select(.context == "check/<name>") | .state]'`;
       the marks file — that of the PR's ticket).
    2. The runs on this head: `gh run list --workflow <workflow> --branch <branch> --event workflow_dispatch --limit 20 --json databaseId,url,headSha,createdAt,status,conclusion --jq "[.[] | select(.headSha == \"$sha\")]"`.
       `gh run list` shows no jobs, so read each candidate, newest first:
       `gh run view <id> --json jobs --jq '[.jobs[] | select(.name == "<job>") | .conclusion]'` —
       `["skipped"]` is a run of another mode on the same commit (it may end `success` all the
       same) and is not this check. `[]` on a run whose `status` (from the list) is not `completed`
       is a run just created, its jobs not listed yet: the check's run. `[]` on a `completed` run
       (a `startup_failure`) is not. Anything else, an empty conclusion of a running job included,
       is the check's run.
    The check's run exists — no dispatch: wait for that run and read it (below). No such run, but a
    `pending` mark — no dispatch either: an earlier dispatch is not listed; the check is not
    verified, the PR waits, and the report says so. Neither — dispatch once (the dispatch command
    with `$ref` = the PR's branch), mark `pending`, and write the dispatch time to the decision log.
    The dispatch command itself exits non-zero (a 422 for an input the branch's workflow does not
    have, a workflow the branch lacks) — no mark, no retry: the report names the reason, and the PR
    waits. After the dispatch, find its run the same way (2), created after the dispatch time. Not
    listed yet — look again a minute later, up to six times, and never dispatch again because the
    run is not listed; still none — the check is not verified, the PR waits, and the report says so.
    Wait for the run as for the batch CI run (below: `gh run watch "$id" --exit-status`), then read
    the job:
    `gh run view "$id" --json jobs --jq '.jobs[] | select(.name == "<job>") | {conclusion, startedAt, completedAt, failed: [.steps[] | select(.conclusion == "failure") | .name]}'`.
  - The job `success` — mark `success --sha "$sha"`.
  - The job `failure` with the test step among `failed` — mark `failure`: a rework round with the
    failing tests (`gh run view "$id" --log-failed`).
  - The run hit the limit — the job `timed_out`, or `cancelled` after about as long as its
    `timeout-minutes` (from `startedAt` to `completedAt`): no mark and no new dispatch. The limit is
    wrong, not the code: the report names the run, its minutes and the limit, so that the limit is
    raised. The PR waits.
  - Any other end — another step failed (checkout, install, a refused input), a cancel by hand, no
    job of that name: no mark, no new dispatch; the report names the run and the step.
  - A new head needs a new dispatch; a mark on the old head does not move.
  - A `pending` mark that no run will settle — the check's run ended with no mark (another step
    failed, a cancel, the limit), or the scope command now gives another answer for a head marked
    `pending` the other way — does not clear by itself: every wave would find the same run and
    wait. It clears by a new push to the PR (a new head, a new check), or by the orchestrator's
    `gh run rerun <id>` of that run once the cause is fixed; either way the report tells the owner
    which run and why.
  - `EXIT=1` (the files that keep the check off the runner follow) — the check is answered the
    other way the rules name, as in the item above.
  - Any other exit code — no verdict: the PR waits; never read it as `EXIT=0`.
- A mark is bound to its commit: after a push or a rebase the new head has no marks, and the PR waits again.
  So a PR merged the old way (a rebase and its own gate full) is rebased before its check is asked for,
  and the block below runs again right before its `gh pr merge`.

The block reads the marks on the head of each ready PR where `ticket mark` writes them — the marks
file of its ticket in Silent mode, and in Full mode with `local-green` in a repository without
`origin`; otherwise the commit statuses of the head — and prints one line per PR: `ready` (every Check
`success` or `skipped`; with no Check in the Pipeline every PR is ready, and the project's rules
pick the platform PRs — "Gate before merge" below), `ready, PLATFORM` (ready,
and at least one Check `success`, not `skipped`), `waits` (a Check with no mark on the head, or
`pending`) or `failed` (a Check `failure`):

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$@" 2>/dev/null; }
E=<epic>
CANDIDATES=(<PR>:<NN> pairs in merge order)   # VERIFIED, CI green on the head (batch: mergeable MERGEABLE); <NN> — the PR's ticket
PL=$(F _resolved.pipeline); NAME=$(F _resolved.name); rc=0
# Where the marks are: the rule of bin/ticket mark (marksStore) — the marks file in Silent mode, and in Full
# mode with local-green in a repository without origin; otherwise commit statuses.
STORE=status
if [ "$(F _resolved.mode)" = silent ] || { [ "$(F workflow.finish)" = local-green ] && ! git -C <repo> remote get-url origin >/dev/null 2>&1; }; then STORE=file; fi
for c in "${CANDIDATES[@]}"; do
  n=${c%%:*}; nn=${c#*:}; st='[]'
  head=$(cd <repo> && gh pr view "$n" --json headRefOid --jq .headRefOid) || { echo "PR $n: no head from gh — waits"; rc=1; continue; }
  if [ "$STORE" = status ]; then
    st=$(cd <repo> && gh api "repos/{owner}/{repo}/commits/$head/status" --jq '[.statuses[] | {context, state, description}]') \
      || { echo "PR $n: no commit statuses from gh — waits"; rc=1; continue; }
  fi
  node - "$PL" "$STORE" "$NAME" "$E" "$nn" "$n" "$head" "$st" <<'NODE' || rc=1
const fs = require("fs"), os = require("os"), path = require("path")
const [pl, store, project, epic, nn, n, head, st] = process.argv.slice(2)
const checks = JSON.parse(pl).filter((s) => s.kind === "check").map((s) => "check/" + s.name)
const marks = new Map()
if (store === "file") {   // the marks file of bin/ticket mark; the last mark of a kind on this head wins
  const file = path.join(process.env.HARNESS_HOME || path.join(os.homedir(), ".claude", "worfy-harness"), "runs", project, "marks", `${epic}-${nn}.json`)
  for (const m of fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).marks : []) if (m.sha === head) marks.set(m.kind, m.verdict)
} else for (const s of JSON.parse(st)) marks.set(s.context, s.state === "success" && s.description === "skipped" ? "skipped" : s.state)
const got = checks.map((c) => [c, marks.get(c) || "none"]), is = (...v) => ([, x]) => v.includes(x)
const verdict = !checks.length ? "ready (PLATFORM if the project's rules make it a platform PR)" : got.some(is("failure", "error")) ? "failed" : !got.every(is("success", "skipped")) ? "waits" : got.some(is("success")) ? "ready, PLATFORM" : "ready"
console.log(`PR ${n} ${head.slice(0, 7)} ${got.map(([c, v]) => c + "=" + v).join(" ") || "no Check in the Pipeline"} — ${verdict}`)
NODE
done; echo "EXIT=$rc"
```

`EXIT=1` — `gh` gave no head or no statuses for a PR (its line says which), and that PR waits. Only
the PRs whose line says `ready` — `ready` or `ready, PLATFORM` — go into `PRS=(…)` of a set (below),
and the `ready, PLATFORM` ones go into its `PLATFORM=(…)` too; with `"each"` or no
`F workflow.merge_gate` the same lines decide which PR may merge. A `waits` PR waits for its mark
and the next set; a `failed` PR goes to rework.

**Gate before merge** (`pr-green-ci`). What the project requires before a PR with code is merged
is `F workflow.merge_gate`:

- absent or `null` — the Harness requires no gate before the merge (the project's `rules.md` may);
- `"each"` — every PR on its own: rebase onto the fresh main branch, `GATE_SCOPE=all` gate full on
  its branch (exit code 0 and the line `[gate] green (…)`), CI again on the new head (with
  `F workflow.ci` `batch` — no CI: `mergeable` is `MERGEABLE`), the merge; then the next PR;
- `"wave"` — one gate full for the set of the wave's ready PRs, with `bin/wave-gate`, as below.

The set is the wave's PRs with `VERIFIED` (no `agent-review` in the Pipeline — without it) and green
CI on their head, in merge order (with `F workflow.ci` `batch`: `VERIFIED` and `mergeable`
`MERGEABLE` — no CI on the head, and red or missing checks do not keep a PR out), that the block of
"Checks before merge" calls `ready`. `PLATFORM=(…)` lists those it calls `ready, PLATFORM`: a Check
ran on them, it was not `skipped`. **With no `check` Stage in the Pipeline** the marks cannot tell
them, and the rule in words stays: `PLATFORM=(…)` lists the platform PRs — those the project's rules
send to another platform's verdict — and each of them merges the old way only after that verdict on
its head (the other platform's gate full: exit code 0 and the line `[gate] green (…)`; a gate of the
release before prints the same line with a Russian word in place of `green`: the same verdict, for one
release). They and the PRs with the label `F cross_machine_gate.label` stay out of the
set, and so do the PRs `wave-gate` takes out (`DIRTY` — a conflict with the set, and the culprit of a
red set): each of them is merged the old way, as with `"each"`, with its Check marks on its new head
(with no `check` Stage — plus the other platform's verdict for a platform PR). A PR
that becomes ready after `check` started waits for the next set. PRs of the set are not rebased and
their CI is not run again before the merge: CI was green on the head, and each merge runs CI on the
push to the main branch (with `batch` there is no CI on a head or on a push: one CI run on the main
branch after the wave, below). `wave-gate` looks at neither checks nor `mergeStateStatus`. It takes the e2e lock (`F workflow.e2e_lock`) for each gate run
and the main-branch lock for the merges itself: do not wrap it in the lock command above.

The screen, on a Mac: a locked screen shows no Electron window, and every e2e fails on its first
window. `wave-gate check` and `wave-gate merge` each keep the display awake while they run
(`caffeinate -d -w <own pid>`, when `caffeinate` is in PATH); between the commands — waiting for CI,
reviews — nothing does outside an Autopilot run. Before each gate run `check` asks `ioreg` whether the
screen is locked: locked — the line `screen locked: gate full waits`, and it waits for the unlock
without holding the e2e lock. Leave it waiting: that is neither an error nor a red run. A red run in
which an e2e script (`test:e2e`, `test:package`) failed while the screen was locked is not red either:
it runs again after the unlock (three runs at most, then `STATUS=unverified`). A gate full outside `wave-gate` (`"each"`, PRs merged the old
way) on a Mac starts only after `ioreg -n Root -d1 | grep -o '"IOConsoleLocked" = [A-Za-z]*'` shows
`No`; with `Yes`, wait for the unlock and do not count a run that failed meanwhile as red.

That gate full of one PR (`"each"`, and a PR merged the old way) runs under the e2e lock
(`F workflow.e2e_lock`) with the lock's semantics unchanged — older than 30 min is abandoned, a
heartbeat `touch -c` every 5 min — and, like `wave-gate`, says who holds it: `holder.json` in the
lock directory names the PR, `gate-full`, the shell's pid and the start time; it goes with the
lock. The heartbeat touches the lock only while its `holder.json` still names this shell's pid,
and it ends once that shell is gone (`kill -0 $$`): a heartbeat that outlived its shell (`kill -9`,
a Bash call cut off by its timeout) keeps neither its own abandoned lock nor another agent's new
one alive. While the shell lives the heartbeat does not end on its own, even when the lock was
taken over, so the trap never signals a pid that is already free. In Git Bash
on Windows (the heartbeat has a `/proc/<pid>/winpid`) the EXIT trap does not stop the heartbeat
with `kill -STOP`: there a `kill -KILL` after a `kill -STOP` can leave the process alive and deaf
to every signal, and a `wait` for it never returns (one run in seven hung for 2 hours). The trap
kills the heartbeat, ends its `sleep` through Windows (`/usr/bin/kill -f`), waits for the
heartbeat at most 2 s, ends it through Windows too after 1 s, and waits for it only once it is
gone. A `sleep` that is still starting when the trap runs may not be visible yet and run out its
5 min, its output on `/dev/null`; before this trap every heartbeat `sleep` there did, because Git
Bash has no `pkill`. Elsewhere the trap stops the heartbeat, and `ps` shows it stopped while a
`fork` it began before the stop may still be under way: the child shows up later, under load
hundreds of ms later (measured on macOS). So every 0.05 s, while the heartbeat is still stopped,
the trap ends any child of it that `ps` shows not yet ended, until three passes in a row find none
(at most 2 s); a fork slower than that still leaves a `sleep` for its 5 min. A child that is
already ended does not count: the stopped heartbeat cannot reap it, it stays a zombie, and on
Linux `pkill -P` matches a zombie, so a loop on its exit code ran all 2 s every time. One Bash call with timeout 600000 (if it ended
while waiting for the lock, run it again):

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$@" 2>/dev/null; }
L=$(F workflow.e2e_lock); [ "$L" = null ] && L=                # no lock in the profile — none taken
ioreg -n Root -d1 2>/dev/null | grep -q '"IOConsoleLocked" = Yes' && { echo "screen locked: waiting"; while ioreg -n Root -d1 | grep -q '"IOConsoleLocked" = Yes'; do sleep 30; done; }
if [ -n "$L" ]; then
  until mkdir "$L" 2>/dev/null; do
    if [ -n "$(find "$L" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rm -f "$L/holder.json"; rmdir "$L"; fi   # older than 30 min — abandoned
    sleep 20
  done
  printf '{"prs":[%s],"what":"gate-full","pid":%s,"since":"%s"}\n' <N> "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$L/holder.json"
  ( while sleep 300; do kill -0 $$ 2>/dev/null || exit 0; grep -q "\"pid\":$$," "$L/holder.json" 2>/dev/null && touch -c "$L" 2>/dev/null; done ) >/dev/null 2>&1 & HB=$!   # its sleep holds no output open; ends with its shell, so the trap never signals a freed pid; touches only our lock
  trap 'if [ -e /proc/$HB/winpid ]; then { c=; for f in /proc/[0-9]*/ppid; do read -r p 2>/dev/null <"$f" && [ "$p" = "$HB" ] && { f=${f%/ppid}; c="$c ${f#/proc/}"; }; done; kill -KILL $HB 2>/dev/null; [ -n "$c" ] && /usr/bin/kill -f -9 $c 2>/dev/null; w=0; while [ $w -lt 20 ] && kill -0 $HB 2>/dev/null; do w=$((w + 1)); [ $w = 10 ] && /usr/bin/kill -f -9 $HB; sleep 0.1; done; kill -0 $HB || wait $HB; } 2>/dev/null; else kill -STOP $HB 2>/dev/null; w=0; while [ $w -lt 200 ] && ps -o stat= -p $HB 2>/dev/null | grep -qv T; do w=$((w + 1)); sleep 0.01; done; pkill -P $HB 2>/dev/null; e=0; w=0; while [ $e -lt 3 ] && [ $w -lt 40 ]; do sleep 0.05; w=$((w + 1)); k=; for p in $(ps -A -o pid=,ppid=,stat= | awk -v h=$HB "BEGIN { while ((getline l) > 0) if (split(l, f) == 3 && f[2] == h && f[3] ~ /^[^Z]/) print f[1] }"); do kill $p 2>/dev/null; k=1; done; if [ -n "$k" ]; then e=0; else e=$((e + 1)); fi; done; kill -KILL $HB 2>/dev/null; kill -CONT $HB 2>/dev/null; wait $HB 2>/dev/null; fi; grep -q "\"pid\":$$," "$L/holder.json" 2>/dev/null && rm -f "$L/holder.json"; rmdir "$L" 2>/dev/null' EXIT   # Git Bash: no STOP, the wait is bounded; elsewhere pkill once ps shows it stopped, then kill its children until 3 passes find none but zombies; only our holder.json
fi
(cd <PR worktree> && GATE_SCOPE=all node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" full </dev/null); echo "EXIT=$?"
```

The state file of the set — one file per set, a new set gets a new file. `<main lock>` is the path
of the main-branch lock above:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$@" 2>/dev/null; }
S=<state file>                                 # e.g. <orchestrator scratchpad>/wave-gate-<epic>-1.json
PRS=(<PR numbers in merge order>)              # the "ready" lines of the Checks block: VERIFIED, CI green (batch: MERGEABLE)
PLATFORM=(<platform PR numbers>)               # its "ready, PLATFORM" lines; none: PLATFORM=()
node - "$S" <repo> <main branch> "$(F workflow.e2e_lock)" "$(F commands.prepare_tree)" "$(F cross_machine_gate.label)" <main lock> "${#PRS[@]}" "${PRS[@]}" "${PLATFORM[@]}" <<'NODE'
const fs = require("fs"), { execFileSync } = require("child_process")
const [file, repo, branch, lock, prepare, label, mainLock, count, ...rest] = process.argv.slice(2)
const platform = rest.slice(+count), val = (v) => (v === "" || v === "null" ? null : v)
const prs = rest.slice(0, +count).map((n) => {
  const p = JSON.parse(execFileSync("gh", ["pr", "view", n, "--json", "number,headRefOid,labels"], { cwd: repo, encoding: "utf8" }))
  return { number: p.number, head: p.headRefOid, labels: p.labels.map((l) => l.name), platform: platform.includes(n) }
})
fs.writeFileSync(file, JSON.stringify({ repo, branch, e2e_lock: val(lock), prepare: val(prepare), cross_machine_label: val(label), main_lock: mainLock, prs }, null, 2) + "\n")
NODE
echo "EXIT=$?"
```

The check runs up to 2+⌈log₂ N⌉ gate full runs of about 12 min each, more than one Bash call
holds: run it with `run_in_background: true` and read its output when it ends. After a session
break, run the same block again: it goes on from the state file without repeating a finished gate
run; when the main branch has moved meanwhile, it checks the set again.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/wave-gate" check <state file>; echo "EXIT=$?"
```

- `EXIT=0` (`STATUS=green`) — merge the set. `flaky` in the state file — the first run was red and
  the repeat green: the failing tests go into the wave report as a flaky test. `STATUS=empty` — all
  PRs are out of the set.
- `EXIT=2` (`STATUS=red`) — red twice; the bisection named `culprit`. Merge `green_prefix` (the
  merge block does exactly that); the culprit goes to a rework round (section 3, a fresh implementer) with
  the log of its run (`runs[].log`); the PRs after it go into the next set.
- `EXIT=3` (`STATUS=unverified`) — could not verify: nothing is merged. Fix the cause named in the
  log of the last run and run the same check again.
- `EXIT=1` — an error, the message says which; the temporary worktree is removed. Nothing is merged.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/wave-gate" merge <state file>; echo "EXIT=$?"
```

`EXIT=0` — merged, the main branch has exactly the checked tree after each PR. `EXIT=4` — stopped:
`merge.stopped` in the state file names the PR and the reason (`base moved` before the first merge
— nothing merged, check again with a new state file; a tree mismatch or a failed `gh pr merge` — the
PRs after it are not merged). After a stop, run gate full on the main branch (the project's lock
command); the PRs not merged go into a new set.
Red CI on the main branch after the set's merges: no new merges. Open a revert of the squash commit
of the first red push run (`git revert <sha>` on a branch, a PR); the revert PR goes the old way,
outside any set, with its own gate full, and the ticket of the reverted PR gets a rework round.
With `F workflow.ci` `batch` there are no push runs: the rule for a red batch CI run is below.

**Batch CI on the main branch** (`F workflow.ci` `batch`). With `pr` — skip this
paragraph: CI already ran on every head and every push. With `batch` the wave gets one CI run on the
main branch, after the last code merge of the wave — the set's `wave-gate merge`, the PRs out of the
set merged the old way, or the last `"each"` merge — and before the documents PR or commit (item 4;
it changes no code, and it goes on while the CI run does). Even when `wave-gate merge` stopped
(`EXIT=4`), what it merged gets the CI run. A wave that merged no code gets none. One CI file per
wave, named by the epic and the wave's number like the state file of the set; the block does not
overwrite an existing one, so after a session break the same block finds the dispatch recorded and
does not start a second CI run while the main branch is still at the recorded commit. When the main
branch has moved since (a file reused by a later wave, a merge after the dispatch), `wave-gate ci`
dispatches anew for the new tip and keeps the old run under `ci_run.superseded`. So once the
documents PR or commit of the wave is merged, do not run the block again: read the recorded run
(`jq -r '.ci_run.run_id' <CI file>`) for the wait below.

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$@" 2>/dev/null; }
C=<CI file>                                    # e.g. <orchestrator scratchpad>/wave-ci-<epic>-<wave number>.json
node - "$C" <repo> <main branch> "$(F workflow.ci)" "$(F workflow.ci_batch_run)" <<'NODE'
const fs = require("fs")
const [file, repo, branch, ci, run] = process.argv.slice(2)
if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ repo, branch, ci: ci || "pr", ci_batch_run: run || null }, null, 2) + "\n")
NODE
"${CLAUDE_PLUGIN_ROOT}/bin/wave-gate" ci "$C"; echo "EXIT=$?"
```

- `EXIT=0` with `CI_RUN=<id> <url>` — dispatched once (`F workflow.ci_batch_run` with `$ref` = the
  main branch) and found; `ci_run` in the CI file has the id, the URL and the commit. Write a row to
  the decision log (section 1; `'batch CI run dispatched for <main branch> <commit>'`, evidence — the
  URL). `CI=skipped` — the profile says `pr`.
- `EXIT=3` (`CI_RUN=not-found`) — dispatched, but GitHub does not list the run yet: run the same
  block again in a minute; it does not dispatch a second time. `wave-gate ci` counts these calls:
  after six without a listed run it answers `CI_RUN=not-verified` (still `EXIT=3`), and so does
  every later call — the CI run of the wave is not verified, with the reason in `ci_run.reason`;
  handle it as a not verified run below.
- `EXIT=1` — an error or a failed dispatch (the message says which; nothing is recorded as
  dispatched): fix the cause and run the block again.

The orchestrator waits for the result before the report (section 5), so the next wave never starts
on a main branch whose CI run is unknown. One long command with Bash timeout 600000; if it did not
finish waiting, repeat it — at most six calls (an hour), then the CI run counts as not verified:

```bash
id=<run id from CI_RUN=>
set -o pipefail; gh run watch "$id" --exit-status --compact --interval 30 | tail -n 5; echo "EXIT=$?"
gh run view "$id" --json status,conclusion,url,jobs --jq '{status, conclusion, url, failed: [.jobs[] | select(.conclusion == "failure") | .name]}'
```

`conclusion` `success` — the wave is green on the main branch; the report says so with the URL.

`cancelled` is not red by itself. Runs of one job on the main branch go one at a time (`ci.yml`
does not cancel a running one), but GitHub cancels a waiting run when a newer dispatch arrives — a
parallel wave, or the owner's run by hand. So look for a newer run of the same workflow on the main
branch (`<workflow>` — the name after `gh workflow run` in `F workflow.ci_batch_run`):

```bash
gh run list --branch <main branch> --event workflow_dispatch --workflow <workflow> --limit 5 --json databaseId,url,createdAt,headSha,status,conclusion
```

A run created after the cancelled one exists — the cancelled run is superseded, not red: its commit
is in the newer run's commit. Write a decision-log row (`'batch CI run <id> superseded by <newer id>'`)
and wait for the newer run with the same block and the same rules. No newer run — the cancelled run
(cancelled by hand) is not verified.

Any other result of a `completed` run (`failure`, `timed_out`, `startup_failure`) is red; a run
still not `completed` after six calls, a cancelled run with no newer one, and `CI_RUN=not-verified`
are not verified. A not verified CI run stops the Autopilot run after the wave the same way as a red
one, with the reason instead of failing jobs. Neither is reverted — the fix goes forward:

- the failing jobs are in `failed`; the failing tests —
  `set -o pipefail; gh run view "$id" --log-failed | grep -E ' FAIL |✘|×' | head -n 20; echo "EXIT=$?"`
  (`EXIT=1` there — no line matched: name the failing step from the log instead);
- file the failure: a new open ticket in the epic (`Source:` — the CI run URL; the failing jobs and
  tests in its first section), or, when the cause is not known yet, a `blocked` line in the state
  file's list of what waits for the owner; and a decision-log row with the URL;
- no new merges in this wave, and the run stops after it: in a session without a human (worfy
  Autopilot) no next wave starts. The report's `— Waiting:` line names the CI run URL and the failing jobs
  and tests. A session with a human reports the same and asks.

**A run that goes with the batch CI run.** The project's rules may name a run on the main branch
that goes with each batch CI run (a name for it, a dispatch command with `$ref`, its workflow, the
job to read and its test step — the same rules as for a check a CI runner may answer, above). No
such rule — skip this paragraph. Right after `wave-gate ci` printed `CI_RUN=`, run the block below
with the same CI file. It dispatches once for the commit of the recorded batch CI run and records
the dispatch in the CI file under `extra_runs.<name>`; run again — after a session break too — it
finds the record for that commit and does not dispatch a second time. When the main branch moved
and `wave-gate ci` dispatched anew, the block dispatches anew too and keeps the old record in
`superseded`.

```bash
C=<CI file>; N=<name of the run, from the rules>; D='<its dispatch command, from the rules>'
node - "$C" "$N" "$D" <<'NODE'
const fs = require("fs"), { spawnSync } = require("child_process")
const [file, name, template] = process.argv.slice(2), st = JSON.parse(fs.readFileSync(file, "utf8"))
const commit = st.ci_run && st.ci_run.dispatched_at && st.ci_run.commit
if (!commit) { console.log("EXTRA_RUN=no-batch-run: run wave-gate ci first"); process.exit(1) }
const runs = st.extra_runs || (st.extra_runs = {}), prev = runs[name]
if (prev && prev.commit === commit) { console.log(`EXTRA_RUN=recorded ${commit} ${prev.run_id || "(id not recorded yet)"}`); process.exit(0) }
// The dispatch runs on the tip of the main branch, and the run is looked up by the batch CI commit: both must be one commit.
const remote = st.remote || "origin", git = (...a) => spawnSync("git", a, { cwd: st.repo, encoding: "utf8" })
const fetched = git("fetch", "-q", remote, `+refs/heads/${st.branch}:refs/remotes/${remote}/${st.branch}`)
const tip = fetched.status === 0 ? git("rev-parse", `refs/remotes/${remote}/${st.branch}^{commit}`).stdout.trim() : ""
if (tip !== commit) { console.log(`EXTRA_RUN=main-moved ${tip || "(git fetch failed)"}: run wave-gate ci again, then this block`); process.exit(1) }
const command = template.split("${ref}").join(st.branch).split("$ref").join(st.branch)
const r = spawnSync(command, { cwd: st.repo, shell: true, encoding: "utf8", windowsHide: true, timeout: 120000 })
if (r.error || r.status !== 0) { console.log(`EXTRA_RUN=dispatch-failed ${((r.stderr || "") + (r.error ? r.error.message : "")).trim().split("\n")[0]}`); process.exit(1) }
runs[name] = { command, commit, dispatched_at: new Date().toISOString(), superseded: prev ? [...(prev.superseded || []), { ...prev, superseded: undefined }] : [] }
fs.writeFileSync(file, JSON.stringify(st, null, 2) + "\n")
console.log(`EXTRA_RUN=dispatched ${commit}`)
NODE
echo "EXIT=$?"
```

- `EXTRA_RUN=dispatched` — write a decision-log row (`'<name> run dispatched for <main branch>
  <commit>'`). Find the run as for a check a CI runner may answer (the newest run of the workflow on
  the main branch whose `headSha` is the commit, created after `dispatched_at`, whose job — read per
  candidate with `gh run view <id> --json jobs` — is not `skipped`; list again a minute later, up to six times, never dispatch again), and record its id:
  `jq --arg n <name> --argjson id <run id> --arg url <url> '.extra_runs[$n] += {run_id: $id, url: $url}' "$C" > "$C.tmp" && mv "$C.tmp" "$C"`.
- `EXTRA_RUN=recorded` — no dispatch: with an id, wait for that run; without one, find it as above.
- `EXTRA_RUN=main-moved` — the main branch is no longer at the commit of the recorded batch CI run:
  nothing is dispatched. Run `wave-gate ci` again (it dispatches anew for the new tip), then this
  block.
- `EXTRA_RUN=no-batch-run` — nothing is recorded as dispatched: run `wave-gate ci`, then this block.
- `EXTRA_RUN=dispatch-failed` (the reason follows: a refused input, a workflow the branch does not
  have) — nothing is recorded as dispatched and nothing is retried: the run is not verified, and the
  report names the reason. The block runs again only once the cause is fixed.

Wait for it with the batch CI block (`gh run watch`) and read the named job as above. The job
`success` — the report says so with the URL. The test step failed — red, handled like a red batch CI
run (the list above: a new ticket or a `blocked` line, the Autopilot run stops after the wave, the fix
goes forward, no revert). The run hit its limit (`timed_out`, or `cancelled` after about its
`timeout-minutes`) — not verified, with no new dispatch: the report names the run and its minutes so
that the limit is raised, and the Autopilot run stops after the wave as for a not verified CI run.
Any other end — not verified the same way. The report's line for the batch CI run names this run too.

1. Ordinary PRs with code — with `merge_gate: "wave"` as a set (above); otherwise one after another,
   as `VERIFIED` verdicts arrive.
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

**Deploy before close** (a `deploy` Stage in the Pipeline, section 0). A merged ticket closes
(`ticket done`, item 4) only when its merge commit is deployed: a commit that carries the deploy mark
has the merge commit among its ancestors. Who deploys and when is the project's rule (`rules.md`;
worfy: the orchestrator's `pnpm install:stable`, which marks the commit it installed). With
`environment` on the Stage the mark is a successful GitHub Deployment of that environment; without
it, the commit status `deploy` `success` — Full mode only: in Silent mode only a Deployment counts.
The block, for each merged PR, after the deploy:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$@" 2>/dev/null; }
M=<main branch>; merge=$(cd <repo> && gh pr view <N> --json mergeCommit --jq .mergeCommit.oid) || echo "PR <N>: no merge commit from gh"
env=$(node -e 'const d = JSON.parse(process.argv[1]).find((s) => s.kind === "deploy"); process.stdout.write((d && d.environment) || "")' "$(F _resolved.pipeline)")
git -C <repo> fetch -q origin "$M"; deployed=
if [ -n "$env" ]; then          # the Deployments of the environment, the newest first; the latest status of one counts
  while read -r id sha; do
    git -C <repo> merge-base --is-ancestor "$merge" "$sha" 2>/dev/null || continue
    [ "$(cd <repo> && gh api "repos/{owner}/{repo}/deployments/$id/statuses" --jq '.[0].state')" = success ] && { deployed=$sha; break; }
  done < <(cd <repo> && gh api "repos/{owner}/{repo}/deployments?environment=$env&per_page=20" --jq '.[] | "\(.id) \(.sha)"')
else                            # the commit status deploy, from the tip of the main branch down to the merge commit
  while read -r sha; do
    [ "$(cd <repo> && gh api "repos/{owner}/{repo}/commits/$sha/status" --jq '[.statuses[] | select(.context == "deploy" and .state == "success")] | length')" -gt 0 ] 2>/dev/null && { deployed=$sha; break; }
  done < <(git -C <repo> rev-list --first-parent "$merge^..origin/$M" 2>/dev/null)
fi
echo "DEPLOYED=${deployed:-none}"
```

`DEPLOYED=<sha>` — deployed: the ticket closes in item 4. `DEPLOYED=none` — not yet: the ticket stays
`claimed` with its PR merged, item 4 does not close it, and its report row says "waits for deploy";
the wave goes on, and the wave or the session that finds the ticket deployed closes it (section "How
to resume a wave").

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
W=$(git -C <repo> worktree list --porcelain | awk -v b="branch refs/heads/$M" 'BEGIN { while ((getline l) > 0) { if (l ~ /^worktree /) w = substr(l, 10); if (l == b) print w } }')
if [ -z "$W" ]; then git -C <repo> worktree add -q "$TMPW" "$M" && W=$TMPW; fi
[ "$W" = "$TMPW" ] || TMPW=no
echo "TREE=$W"; echo "TEMPORARY=$TMPW"
```

   In `TREE`: `ticket block` for each removed ticket (run from `TREE`), the state file, the result
   sections. Then, still under the lock — the block commits only this epic's folder of the tickets
   root and the state file, and removes the temporary worktree whether the commit worked or not:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$@" 2>/dev/null; }
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
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$@"; }
W=$(F _resolved.workflow_folder)
if git -C "$W" rev-parse --git-dir >/dev/null 2>&1 && [ -z "$(git -C "$W" rev-parse --show-prefix)" ]; then   # its own repository; no path compare: Git Bash spells C:/ and /c/
  git -C "$W" add -A . && git -C "$W" commit -q -m "<epic>: wave of tickets <NN>, <NN> — statuses, state file"; echo "EXIT=$?"
else echo "the Workflow folder is not a git repository of its own: the files are saved, nothing to commit"; fi
```


```bash
"${CLAUDE_PLUGIN_ROOT}/bin/ticket" done <epic> <NN> --pr <N>                  # for each merged ticket (with deploy in the Pipeline — each DEPLOYED one); with local-green — without --pr
"${CLAUDE_PLUGIN_ROOT}/bin/ticket" block <epic> <NN> "<reason it was rejected by the gate>"   # for each removed one; the reason in the docs' language
```

A conflict with the base at any step: the implementer rebases onto the base in its own worktree
(regenerate the migration with `F numbering.migrations.generate`, do not resolve it by hand), then
the gate again, then the merge. The next PR is taken after the previous one is merged: CI runs on
the fresh merge commit. CI does not start on a PR in state `DIRTY`, and the wave's documents
commit changes ticket files, so open PRs (of the next wave, of a parallel wave, not yet merged)
become `DIRTY`. So check `mergeStateStatus` and rebase before the rework round and before waiting
for CI, not after. With `F workflow.ci` `batch` there is no CI to wait for: check `mergeable`
(`CONFLICTING` — rebase) before the rework round and before the merge.

**Cleanup after the merge.** Once a ticket's PR (and the wave's documents PR) is merged — at once
`git worktree remove <worktree>` and `git branch -D <branch>`; the verifiers' worktrees too. With
`local-green` the same after `MERGED=0` (`git branch -d <branch>` — the branch, with its documents
commit, is in the main branch by then). A
worktree stays only for a ticket removed from the wave with an open PR. An old ticket branch in a
live worktree is not litter but a false signal: worfy reads ticket status from worktree branches
too, and `claimed` from a merged branch overrides `done` on main (a board once showed "3 in work"
after the merge).

## 5. Report

A table for the wave, then the four groups of findings of every ticket whose gate gave any
(section 3: Act on, Consider, Noted, Dismissed, an empty group as "none"), then the four-line
status block, which stays last. Its labels stay exactly as written —
`— Stage:`, `— Now:`, `— Next:`, `— Waiting:` — whatever the reports language: worfy reads them
(`src/shared/agent/status-block.ts`); the values are in `F language.reports`. `— Stage:` — the
output of `"${CLAUDE_PLUGIN_ROOT}/bin/epic-status" <epic>` after a fast-forward of the main branch; `— Now:` —
only what the gate and the live address confirmed (with `local-green` or without `deploy` — the
gate); `— Waiting:` — a decision on a `blocked` ticket, or "nothing". Re-read every `file:line` from
the verifier's answer yourself before quoting it.

| Ticket | PR | Gate | Rework | Production |
|---|---|---|---|---|
| 07 | #341 | REJECTED → VERIFIED | 1 round | 1a2b3c4 |
| 09 | — | REJECTED ×2 | blocked | — |
| 11 | #344 | REJECTED ×2 → NARROW: VERIFIED | 1 round + narrow | 5e6f7a8 |

Every entry of an implementer's `sign_in_needed` goes under the table as one line, word for word:
`<NN>: sign-in needed as <role>` or `<NN>: sign-in expired in Browser profile <name>`; a wave
without such entries has no such line. The ticket is not `blocked` for it.

With `F workflow.ci` `batch` one line goes under the table: `CI on <main branch>: <URL> — green`,
`— red: <failing jobs and tests>`, `— not verified: <why>`, or `— none: the wave merged no code`.
A ticket the wave does not merge or close because of its Pipeline (section 0) has in the "Gate"
column its verdict and whom it waits for: `waits: check/<name>`, `waits: people (human-review)`,
`waits: people (awaiting-merge)` or `waits: deploy`; it is not a `blocked` row.
The "PR" and "Production" columns are "—" with `local-green` and without `deploy`. The "Rework"
column shows a narrow round as "+ narrow"; a narrow round that ended in `NARROW: REJECTED` is a
`blocked` row.

Under the table, for every ticket of the table, the two report lines of its gate (section 3): its
depth and where it came from, and the subagent tokens of each of its rounds with their sum, or
`not measured`:

```
07: Review depth: low — default: the profile has no review.depth.wave
07: Review tokens: 410000 + 380000 = 790000
```

**A wave without a human names its decision log** (section 1). Before the report is written,
compare the two: every decision the report shows — a `blocked` row, a narrow round, a ticket that
was not dispatched, a Dismissed finding, a fork settled for the owner, a merge out of the plan's
order — has its row in the log (`cut -f2 <path>` prints the decisions). A decision without a row
gets one now, and its `<why>` starts with `added at reconciliation: `; the rows already written
are not edited. Then one line goes between the groups of findings and the status block:
`Decision log: <path>`, or `Decision log: not written — <reason>`.

## How to resume a wave

In Silent mode the status is one, in the Workflow folder, and a ticket names its branch in the `Branch:`
line: the wave is read from those lines, not from the `<epic>/*` branches. `<repo>` is the main
checkout; a ticket with a `Repo:` line is looked up in that repository:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$@"; }
(cd <repo> && "${CLAUDE_PLUGIN_ROOT}/bin/epic-status" --json) \
  | jq -r '.tickets[] | select(.epic=="<epic>" and .state!="open") | [.num, .state, (.branch // "-"), (.repo // "-")] | @tsv' \
  | tr -d '\r' | while IFS=$'\t' read -r n st b r; do
      d=<repo>; [ "$r" = - ] || d=$(F _resolved.repos | jq -r --arg r "$r" '.[] | select(.name==$r) | .path' | tr -d '\r')
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
`<epic>/` replaced by `*`; below — for `<epic>/<NN>-<slug>` and `<epic>/<NN>`):

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
and with no such verdict yet the narrow round's gate is ahead. A ticket marked `Risk: high` whose PR
has no `MAX-REVIEW:` comment gets `/worfy:max-review` before its merge (section 4); otherwise the last
`MAX-REVIEW: …` comment is its verdict. An open PR with `VERIFIED` waits for what the Pipeline puts
before the merge (section 0): its Checks — the block of "Checks before merge" says which mark is
missing — or people. A merged PR while `state` is not
`done` — the documents PR is still ahead (section 4, item 4); with `deploy` in the Pipeline, first the
block of "Deploy before close": `DEPLOYED=none` keeps the ticket open.

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
A `gate: MAX-REVIEW: …` commit is not a gate verdict: it does not restart the gate, and "the last
`gate: VERIFIED`" above is read past it. A ticket marked `Risk: high` without such a commit gets
`/worfy:max-review` before its merge (section 4); otherwise the last `gate: MAX-REVIEW: …` commit is
its verdict. The block prints both — Full mode only, where the verdicts are commits (`git log` lists
the newest commit first):

```bash
log=$(git -C <repo> log --format=%s <base>..<branch>)
echo "GATE=$(grep '^gate: ' <<<"$log" | grep -v '^gate: MAX-REVIEW:' | head -n 1)"
echo "MAX-REVIEW=$(grep -m1 '^gate: MAX-REVIEW:' <<<"$log")"
```

In Silent mode the verdicts are the `gate:` lines at the end of the ticket file in the Workflow folder
(section 3), and the newest line is the last one, so the same rule reads the file from its end
(`<ticket file>` — the path found as in section 3, `f=$(ls …/<epic>/issues/<NN>-*.md)`):

```bash
f=<ticket file>
echo "GATE=$(grep '^gate: ' "$f" | grep -v '^gate: MAX-REVIEW:' | tail -n 1)"
echo "MAX-REVIEW=$(grep '^gate: MAX-REVIEW:' "$f" | tail -n 1)"
```

Then — from section 1: the preflight is idempotent.
