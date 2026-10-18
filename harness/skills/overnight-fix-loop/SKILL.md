---
name: overnight-fix-loop
description: An autonomous overnight run over the modules of any registered project — adversarial tests, fixing until green, mutation testing, review, merging each module into the night branch, one PR into the main branch in the morning. Takes the module layout, commands, GitHub account and deploy from the profile (`${CLAUDE_PLUGIN_ROOT}/bin/profile`). Manual invocation only, for the night — `/worfy:overnight-fix-loop <modules>` or `claude -p`; asks the user no questions.
disable-model-invocation: true
---

# Overnight run: red → green → mutations → integration

One invocation — several modules, each in its own worktree and its own `worfy:implementer` agent.
A finished module is merged into the night branch `overnight/<date>`. Nothing is merged into the main branch at night:
for a project with a deploy (`deploy` in the profile is not `null`) a merge into it ships to production (`deploy.how`), so
the last merge is a human's decision in the morning.

## Project profile

Everything project-specific — packages, modules, commands, worktrees, GitHub account, deploy — comes from the profile
(`${CLAUDE_PLUGIN_ROOT}/bin/profile`, contract — `~/.claude/profiles/README.md`). Below, `F <field>` is shorthand
for `"${CLAUDE_PLUGIN_ROOT}/bin/profile" --field <field>` in the project root; in the bash blocks it is declared as a function
on the first line. The skill is run from the project root (or with `-C <root>` on every `profile` call).

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/profile" --name; echo "EXIT=$?"
```

- `0` — work by the profile.
- `3` — the project is not registered or has no profile. **Stop**: write into
  `<scratchpad>/OVERNIGHT-REPORT.md` and into the answer "project `<path>` is not registered — there is no profile,
  nothing to run the night against" and start nothing. Do not guess commands or paths.
- `1`, `2` — the registry or the profile is broken: the same stop, with the message from stderr.

A missing field (`F` returned exit code 4 or printed `null`) turns off the step that depends on it;
a turned-off step is a line in the morning report, not a silent skip.

The project facts of the overnight run are in profile fields: the module layout and the limit for heavy packages
(`F modules`), the commands of one package (`F commands.package`), new-test files and test-file globs
(`F tests.new_file`, `F tests.globs`), the GitHub account (`F github.account`). What does not fit into a field is in
the section `## Ночной прогон и аудит` (overnight run and audit) of the profile's `rules.md` (`"${CLAUDE_PLUGIN_ROOT}/bin/profile" --rules`):
mandatory rebuilds, project-specific bug classes, why the limit is what it is. Read it once before
the start; below it is called "the profile section". The morning report and the briefs are in the language of `F language.reports`;
commit messages, PR titles and descriptions, code comments — in the language of `F language.team`
(the templates `test(<имя>): red — …` and `overnight(<имя>): …` below are a form, not a language).

Shell state does not persist between Bash calls: every block below declares `F` itself and derives
the variables it uses itself.

## Parallelism and queue

No more than five agents at once in total; heavy packages (their tests bring up their own database or stack) — with
the limit from `F modules.heavy` (`{"<package>": <modules at once>}`); modules of the other packages run on top of
that limit. Modules are taken as a queue: a slot frees up — the next one is taken, and so on until the time
budget runs out (by default six hours from the start, otherwise an argument like `until 06:30` or `до 06:30`). Modules not taken
go into the morning report as a "not started" line. The main session is the orchestrator: it hands out modules, merges
their branches, writes the morning report. A question to the user at night is an entry in `FAILURE.md` and a stop of the module.

`F parallel` = `single` (one local stack per project) — modules strictly one at a time, no worktrees:
the module branch is created in the main checkout (`git switch -c overnight/<date>-<имя> overnight/<date>`),
and only if `git status --porcelain` there is empty; not empty — the whole run stops with a line in the report.

The run's files live in the session's scratchpad directory (the session gives the path): `<scratchpad>/overnight/<имя>/PR.md`,
`FAILURE.md` next to it, `<scratchpad>/OVERNIGHT-REPORT.md`. They must not be kept inside the worktree: they are not in
`.gitignore`, and 1b and 1d commit with `git add -A` — the files would end up in the module's commit.

`<имя>` throughout is the module name (the same placeholder the profile's `tests.new_file` uses).

## 0. The night branch and choosing modules

The integration branch — one per run, from a fresh base `F worktree.base` (exit code 4 — the main branch:
`git symbolic-ref -q --short refs/remotes/origin/HEAD`):

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" --field "$1"; }
git fetch origin --prune
BASE=$(F worktree.base) && [ "$BASE" != null ] || BASE=$(git symbolic-ref -q --short refs/remotes/origin/HEAD)
NIGHT=overnight/$(date +%F)          # the branch already exists (restart, a second session) — reuse it
git rev-parse --verify --quiet "origin/$NIGHT" \
  || { git branch "$NIGHT" "$BASE" && git push -u origin "$NIGHT"; }
```

A module is a directory directly under `<package>/src` for every package from `F layout.packages`
(`apps/api/src/auctions`). The field `F modules` refines this: `deep` — roots where a module is a directory one
level deeper; `flat` — packages that are a single module as a whole; `skip` — directory names that
do not form modules. No field — all three are empty. Files in the root of a package's `src` do not form a module. The module name is the last path segment; for
a package from `FLAT` — the package directory name; when names collide — with the package prefix (`api-catalog`,
`web-catalog`). If no list is given — the most changed over 30 days:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" --field "$1"; }
BASE=$(F worktree.base) && [ "$BASE" != null ] || BASE=$(git symbolic-ref -q --short refs/remotes/origin/HEAD)
PK=$(F layout.packages | jq -r 'join(" ")' | tr -d '\r')
M=$(F modules 2>/dev/null) && [ "$M" != null ] || M='{}'
DEEP=$(jq -r '.deep // [] | join(" ")' <<<"$M" | tr -d '\r'); FLAT=$(jq -r '.flat // [] | join(" ")' <<<"$M" | tr -d '\r'); SKIP=$(jq -r '.skip // [] | join(" ")' <<<"$M" | tr -d '\r')
# pathspec as an array, not `for p in $PK`: the Bash tool runs zsh, and zsh does not split
# an unquoted variable into words, so the loop would run once over the whole string
SRC=(); while IFS= read -r p; do SRC+=("$p/src"); done < <(F layout.packages | jq -r '.[]' | tr -d '\r')
git log "$BASE" --since=30.days --name-only --pretty=format: -- "${SRC[@]}" \
  | awk -v pk="$PK" -v deep="$DEEP" -v flat="$FLAT" -v skip="$SKIP" '
      BEGIN { np=split(pk,P," "); nd=split(deep,D," "); nf=split(flat,F," "); ns=split(skip,S," ") }
      NF==0 { next }
      { for (i=1;i<=ns;i++) if (index($0, "/" S[i] "/")) next
        for (i=1;i<=nd;i++) if (index($0, D[i] "/")==1) { r=substr($0, length(D[i])+2); if (r ~ /\//) { sub(/\/.*/,"",r); print D[i] "/" r }; next }
        for (i=1;i<=nf;i++) if (index($0, F[i] "/src/")==1) { print F[i] "/src"; next }
        for (i=1;i<=np;i++) if (index($0, P[i] "/src/")==1) { r=substr($0, length(P[i])+6); if (r ~ /\//) { sub(/\/.*/,"",r); print P[i] "/src/" r }; next } }' \
  | sort | uniq -c | sort -rn | head -8
```

The module's tree is created from the night branch, under `F worktree.root`; other trees are held by other sessions — do not
touch them. The module branch name cannot start with `overnight/<date>/`: git does not create a branch inside an
already taken name, so the separator is a hyphen. Dependencies are installed by `F commands.install` inside the tree.

```bash
git worktree add <worktree.root>/overnight-<имя> -b overnight/<date>-<имя> overnight/<date> \
  && (cd <worktree.root>/overnight-<имя> && <commands.install>)
```

Before 1a — a `worfy:scout` over the module, with the module tree path in the brief: entry points, the call chain and, if
the profile section or `rules.md` names code that goes to the database bypassing the schema, which tables of the module
it reads. The map goes into the implementer's brief.

## 1. The loop over a module — a `worfy:implementer` agent, one per module

The agent is built around tickets (`tickets.path`, `claim`, JSON with `ticket`, the steps of `workflow.ticket_skill`).
The brief says explicitly: there is no ticket, do not `claim`, do not load the ticket skill, the order is steps 1a–1e of this
skill, the report follows the form below, not the ticket JSON; no push and no PR until the orchestrator's message
(the agent's step 6, `pr-green-ci`, is replaced here by step 1g). Give it: the worktree path (the profile — `-C` on it; work
only in it, do not create a tree of its own), the module name and directory, the night branch name, the map from `worfy:scout`,
"Bug classes" together with the project-specific ones from the profile section, the paths of `PR.md` and `FAILURE.md`. The implementer
goes through 1a–1e and stops at a green gate: no push, no PR. It does not run a reviewer — review is the
orchestrator's step (1f); the implementer opens the PR only on the orchestrator's message after the verdict
"clean" (1g). Back — ≤30 lines: the tests, the exit codes of every run, the mutation line "before → after",
the gate exit code and its `[gate] …` line, the SHA of the last commit of the module branch (everything committed) or the path of
`FAILURE.md`; no retelling of the work.

Changes — only inside the module's footprint: its directory and its new test file. A change outside the footprint needed
for green is a `FAILURE.md`, not an extension of the footprint. Print the exit code next to every run;
filtering long output — only `set -o pipefail; <command> | tail -n 20` (without it the hook
`guard.mjs` refuses a pipe that follows a verification command).

Commands below: `<package typecheck>`, `<package test>`, `<package test_one>` — the templates
`F commands.package.typecheck`, `.test`, `.test_one`; `<package>` — the name from `F commands.package.names`
by package directory (`apps/api` → `@auction/api`), `<file>` — a path from the package root. No
`commands.package` — `F commands.typecheck`, `F commands.test`, `F commands.test_one` from the root.

### 1a. Module tests, mutation points and the "before" baseline

The module reads existing test files but does not edit them: shared test files usually import more than
one module, and two parallel agents would collide in one file. New tests always go into a new
file, one per module, with the `.hardening` suffix; where it lives in each package is given by the template
`F tests.new_file` by package directory (`<имя>` — the module name, `<каталог модуля>` — its path). No
field, or no package in it — next to the nearest existing test of that package, following its naming pattern.

The module's test list for mutation testing — the existing test files that import the
module directory, plus the new file. The search runs from the package directory; the directories — those of `test` and `src`
that exist there; the test-file globs — `F tests.globs` (no field — globs following the package's test naming pattern):

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" --field "$1"; }
# Globs as a quoted array: that way neither bash nor zsh expands them (`set -f` in zsh does not
# turn globbing off, and an unquoted `$INC` string is not split into words in zsh — grep got one glued glob)
INC=(); while IFS= read -r g; do INC+=("--include=$g"); done < <(F tests.globs | jq -r '.[]' | tr -d '\r')
DIRS=(); for d in test src; do [ -d "<каталог пакета>/$d" ] && DIRS+=("$d"); done
cd <каталог пакета> && grep -rslE "/<имя>(/|')" "${INC[@]}" "${DIRS[@]}"   # exit 1 on an empty result is not an error
```

`<каталог пакета>` is the package directory. The list is fixed here and used unchanged in 1d.

Read the module, choose at least five mutation points (see "What to break"); fewer than
five suitable places — take all of them and record their number. For each: break it, run the module tests, record
red/green, restore the file with `git checkout -- <file>`. The result — "before: X of N red".

### 1b. Adversarial tests — RED, committed

Write tests following the "Bug classes" below — what has already broken in the project. Completion condition:
the package `typecheck` is green, the targeted run of the new tests is red on an assertion,
not on a compile error.

```bash
<package typecheck>; echo "EXIT=$?"
<package test_one with the new file>; echo "EXIT=$?"
git add -A && git commit -m "test(<имя>): red — <what is checked>"
```

Mandatory rebuilds before `typecheck` (a package that others read in built form) are in the profile
section; the reason is there too.

From this commit on the test text is frozen: an expectation changed to get green is a `FAILURE.md`.
New tests are green on the first run — rewrite the assertion stricter; green the second time too —
close the module with the report line "nothing to harden", do not open a PR.

### 1c. Fix until green — no more than 15 iterations

After every change — the whole suite of the package where the change is, bare:
`<package test>; echo "EXIT=$?"`. The fifteenth iteration is red — stop,
write `FAILURE.md`: which test is red, what was tried, what it is stuck on. The module is closed, do not open a PR.

### 1d. Mutation testing

Commit first: restoring after a mutation wipes anything uncommitted. The same points and the same
test list as in 1a, one at a time: break → run the module tests → red is expected →
`git checkout -- <file>` (one path; the hook refuses `checkout -- .`). The result "after: Y of N red".

The threshold is 80 % killed. Below the threshold: for every surviving mutation add a test, repeat 1c
once, run the mutations again. A second shortfall — `FAILURE.md` listing the survivors, do not open a PR.

### 1e. Gate

The gate is `gate.mjs fast`: the root lint plus `typecheck` and `test` of the changed packages. Green is exit 0
**and** the line `[gate] зелено (…)`; exit 0 with the line «ничего не прогналось» or «окружение
недоступно» is not a check. Exit 2 is red (`[gate] красно`). Exit 3 is unverified, neither green nor red: the line
`[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: …` names the reason (project not registered, registry unreadable,
resolver crashed). A red gate, exit 3, and exit 0 without the «зелено» line — `FAILURE.md` with that
line, no review, no PR, no merge. Before the gate everything is committed: the reviewer looks at the diff of the commits,
the push in 1g sends only commits. Rebuilds that the profile section requires before
`typecheck` and the gate — once before the gate; after each mutation — only if the section says so.

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null; echo "EXIT=$?"   # stdin closed, otherwise the script waits on cat forever
```

### 1f. Review — the orchestrator runs a `worfy:reviewer` agent after the implementer's report

There is no PR yet: the review comes before it, over the local module branch. As with the gate in `worfy:epic-wave`: the module tree
is idle by this point, and there is one checker in it; do not run a second agent there, mutations —
only on copies in the scratchpad. Lens "correctness and file footprint". The brief carries the module tree path,
the night branch, the diff `git diff overnight/<date>...HEAD` in that tree and the implementer's report. The report is
a claim, not a fact: the reviewer repeats every verification command itself (the gate — with the exit-code rule from
1e) and pastes the exit codes. Contract: findings only, `file:line`, ≤30 lines, an explicit "clean".
The orchestrator re-reads every reference itself.

There are findings — the orchestrator hands them to the same implementer via `SendMessage`: exactly one round of
rework (1c → 1e with a commit, no push and no PR, the new SHA in the answer), then review again. Not "clean" the second time — the orchestrator
writes `FAILURE.md` with the findings, no PR is opened, the module drops out of the night.

### 1g. PR into the night branch — only after "clean"

The verdict "clean" is in — the orchestrator, via `SendMessage`, tells the same implementer to open the PR
(as before, the module's agent opens the PR); the message carries the reviewer's verdict and the SHA it
looked at. The implementer first compares `git rev-parse HEAD` with that SHA: no match — do not open the PR,
answer the orchestrator (the review saw different code).

```bash
git push -u origin overnight/<date>-<имя>
gh pr create --base overnight/<date> --title "overnight(<имя>): <what was hardened>" \
  --body-file <scratchpad>/overnight/<имя>/PR.md
```

`GH_TOKEN` of `F github.account` is set by the plugin's `SessionStart` hook (`hooks/gh-token-env.mjs`) for every
Bash command of the session and of its agents; do not switch the global `gh` account. If `gh` answers "Could not
resolve to a Repository", compare `gh auth status` with `F github.account` and say so in the answer.
In the body: the tests as a list, "mutations: before X of N → after Y of N", the gate exit code, the 1f reviewer's verdict.
The implementer returns the PR number and stops there: the merge is the orchestrator's step.

### 1h. Merging the module — done by the orchestrator

Checks and merge — three separate commands, no pipe between them:

```bash
gh pr checks <N> --watch --fail-fast; echo "EXIT=$?"
gh pr view <N> --json mergeStateStatus -q .mergeStateStatus   # CLEAN — merge
gh pr merge <N> --squash --delete-branch
```

The merge condition — all three at once: green CI, `CLEAN` and "clean" from the 1f reviewer (without it the PR would not
have been opened at all). Otherwise:

- `DIRTY` — rebase the module branch onto the night branch, run the gate again, wait for the
  checks, merge. A second conflict — `FAILURE.md`, the PR stays open.
- Red checks (non-zero exit of `gh pr checks`) or any other state
  (`BLOCKED`, `UNSTABLE`, `BEHIND`) — `FAILURE.md` with the name of the failed job, the PR stays
  open, the module drops out of the night. Fixing at night a CI that is green locally means editing blind.

With `F workflow.ci` `batch` (worfy ADR-0068) GitHub CI does not run on a PR: skip `gh pr checks` and
`mergeStateStatus`. The merge condition is two at once: `mergeable` is `MERGEABLE` and "clean" from the 1f
reviewer; `CONFLICTING` is handled as `DIRTY` above. The night's CI run is one, in section 2.

```bash
gh pr view <N> --json mergeable -q .mergeable   # batch: MERGEABLE — merge; CONFLICTING — as DIRTY
```

The night branch has moved after the merge: this does not affect the next module, the module footprints and test
files do not overlap.

## Bug classes — what to check with an adversarial test

A test for every applicable item, not for invented ones. General:

- Date and time zone computed in the application instead of the database; the day boundary in the project's time zone.
- A regular expression on `CRLF` versus `LF`.
- A scheduler makes two state transitions in one pass (warn and close in
  one tick) — a test for exactly one transition per pass.
- Parsing a status from a string: case, whitespace, an unknown value.
- An exit code swallowed by a pipe — for the module's scripts, if it has any.

Project-specific ones — from the profile section (time zone, ORM traps, code that reads the database bypassing the schema).

## What to break — mutation points

Invert a branch condition; shift a boundary (`<` ↔ `<=`); remove an `await`; change
the status in a transition to the neighbouring one; return a constant instead of a computation; remove one branch
of a `switch`. One mutation — one place — one run.

## Not to do at night

Merging into the main branch and any production deploy; migrations and any schema changes; changes outside the module
footprint; editing other test files; contract tests (`F commands.contract`); `push --force`;
changes to ADRs (`F docs.adr_dir`), the state file (`F docs.handoff.path`), `CLAUDE.md`. Anything needed from
this list — an entry in `FAILURE.md` and the morning report, the module's work stops.

## 2. Integrating the night — one PR into the main branch, left open until morning

The queue is empty or the time budget is used up — first write `OVERNIGHT-REPORT.md` (section 3), which also
serves as the PR body; then open the PR of the night branch and wait for the checks:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" --field "$1"; }
BASE=$(F worktree.base) && [ "$BASE" != null ] || BASE=$(git symbolic-ref -q --short refs/remotes/origin/HEAD)
MAIN=${BASE#origin/}                 # the main branch — the target of the integration PR
gh pr create --base "$MAIN" --head overnight/<date> --title "overnight <date>: <K> modules" \
  --body-file <scratchpad>/OVERNIGHT-REPORT.md
gh pr checks <N> --watch --fail-fast; echo "EXIT=$?"
```

The PR stays open. Red checks of the integration — a line in the report with the PR number and the failed job,
triage in the morning: fixing at night what is green module by module but red together means editing blind.

With `F workflow.ci` `batch` the PR gets no checks, and `gh pr checks` is not run. The night gets one CI run, on
the night branch: the CI file and the `wave-gate ci` block of skill `/worfy:epic-wave`, section 4, "Batch CI on the
main branch", with `overnight/<date>` in place of `<main branch>`; then its wait block. The report gets the run's
URL and its result instead of the checks; a red run is triaged in the morning the same way.

## 3. Morning report

`OVERNIGHT-REPORT.md` in the session's scratchpad directory: a table per module, then the status block.
Into the table go only a PR with the gate exit code and a `FAILURE.md` with the reason.

| Module | Tests added | Mutations before → after | PR | Merged | FAILURE |
|---|---|---|---|---|---|
| `<имя>` | 7 | 1 of 5 → 5 of 5 | #NNN | yes | — |

What is left for the human is to confirm the merge. After their "yes" — two commands in a row, then the production check
(only if `F deploy` is not `null`; otherwise there is nothing to check after the merge — say so):

```bash
gh pr merge <N> --merge --delete-branch      # module commits stay separate; --squash if one is needed
```

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" --field "$1"; }
BASE=$(F worktree.base) && [ "$BASE" != null ] || BASE=$(git symbolic-ref -q --short refs/remotes/origin/HEAD)
MAIN=${BASE#origin/}
sha=$(gh pr view <N> --json mergeCommit -q .mergeCommit.oid)
id=$(gh run list --branch "$MAIN" --limit 10 --json databaseId,headSha \
       -q "[.[] | select(.headSha==\"$sha\")][0].databaseId")
gh run watch "$id" --exit-status; echo "EXIT=$?"      # the deploy in this CI run — F deploy.how
got=$(<F deploy.production_check>); echo "EXIT=$? commit=$got sha=$sha"
```

With `F workflow.ci` `batch` the merge starts no push run on the main branch, so this block finds no `id`: the
production check of such a project is not covered here and is "not verified" in the report.

The expectation is `F deploy.production_expect`: a non-zero `EXIT`, an empty `commit` or a `commit` not equal to
`$sha` — production is "not verified", and that is what gets written. The environment's password never goes into command arguments — only the way
`F deploy.production_check` does it.

    — Этап: outside epics (overnight run)
    — Сейчас: <modules merged into the night branch, how many in FAILURE, state of the integration PR>
    — Дальше: confirm the merge of PR #<N>
    — Жду: a "yes" to the merge into the main branch, or a triage of FAILURE

The four labels are what worfy parses; the values are in `F language.reports`.

## Running without a terminal (not verified)

With no human at the terminal any permission request stops `-p`, and `--permission-mode dontAsk` answers
it with a refusal — the same stop; hence `--dangerously-skip-permissions`. The ceiling is money: `claude` has no flag for the number of turns.
Run from the project root: that is how `profile` finds the profile.

```bash
cd <project root> && claude -p "/worfy:overnight-fix-loop <module dir> <module dir> until 06:30" \
  --dangerously-skip-permissions --max-budget-usd 40
```
