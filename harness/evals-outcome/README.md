# Outcome eval: the task slot

This folder holds the tasks of an eval that compares outcomes. Every task runs twice on the same
model and the same repository: once with the plugin under test loaded, once without any plugin (the
baseline arm of `claude plugin eval --ablation with-without`). The tasks are added later, one folder
each. Nothing here ships with the app.

This folder is part of the plugin copy a run loads, so it holds only what a task needs to start.
How a run is scored lives outside the plugin, in `scripts/eval-outcome/README.md` of the repository.

## Layout

```
harness/evals-outcome/
  README.md                  this file
  lib/fixture.sh             the shared base repository every task starts from
  lib/home-guard.cjs         refuses a scaffold started with the user's real HOME
  lib/plugin-state/<name>.sh the state one plugin under test reads to recognise the repository
  <task>/                    one folder per task, read by `claude plugin eval`
    prompt.md                the request, as a user would type it, with YAML front matter
    case.yaml                `schema_version: "1.1"`, `name: <task>`, `context.scaffold_script: scaffold.sh`
    scaffold.sh              builds the run's working folder: the fixture, the plugin state, the task's own changes
    graders/*.md             graders inside `claude plugin eval`: regex, tool_used, tool_order,
                             file_exists, llm, baseline (no other kinds exist)
```

Until the tasks are written their folders are absent; that is allowed.

Rules for the text of a task (the contract test `test/contract/harness-evals-outcome.test.ts`
checks the first one):

- `prompt.md`, every file in `graders/`, `lib/fixture.sh` and the README the fixture writes contain
  none of the words that name the plugin under test or its own concepts. The test holds the list.
- `prompt.md` front matter: `description`, `runs`, `max_turns`, `timeout_seconds`,
  `allowed_tools`. The body is the request and nothing else.
- Everything `scaffold.sh` creates is visible to the agent during the run, in both arms.

## The fixture

`lib/fixture.sh` builds, in the current (empty) folder:

- a git repository on branch `main` with one commit: a small Node package (`src/`, `test/`,
  `package.json` with `"test": "node --test"`), a `.gitignore` and an ordinary `README.md` that
  names the test command. No network, no dependencies to install;
- a local bare repository `.git/fixture-origin.git` as `origin`, with `main` pushed, so push and
  fetch work without a network;
- a repository-local git identity (`Fixture Author <fixture@example.invalid>`), so commits work in
  the run's empty HOME for both arms alike.

It knows no plugin and names no file outside `lib/`. It refuses to run when HOME is the user's real
home folder.

Each script of `lib/plugin-state/` writes the state one plugin under test reads to recognise the
repository as a project of its own (for example a project profile), inside `.git/` and the run's
temporary HOME, never in the working tree. A scaffold runs all of them after the fixture: it cannot
know which arm it builds, so both arms get the same files, and in the arm without the plugin nothing
reads them. A plugin that needs no state brings no script.

A scaffold builds on both:

```bash
#!/usr/bin/env bash
set -euo pipefail
lib="$(dirname "$0")/../lib"
bash "$lib/fixture.sh"
for state in "$lib"/plugin-state/*.sh; do [ ! -e "$state" ] || bash "$state"; done
# the task's own files, then one commit; fixed dates keep commit hashes stable
export GIT_AUTHOR_DATE=2026-10-02T12:00:00Z GIT_COMMITTER_DATE=2026-10-02T12:00:00Z
cat >src/price.mjs <<'EOF'
...
EOF
git add -A && git commit -q -m "Add price helpers"
```

`claude plugin eval` starts the scaffold with a short fixed environment: PATH, HOME (a temporary
folder), TMPDIR and a few more. The working folder is `$HOME/cwd`.

## Running

`pnpm eval:outcome` runs the tasks of this folder; `scripts/eval-outcome/README.md` describes it.
