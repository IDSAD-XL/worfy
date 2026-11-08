#!/usr/bin/env bash
# Fixture of the case: project demo, finish local-green, no variant (harness/evals/lib/demo-project.sh),
# and on top of it, committed on main and pushed to origin, two plans that wait for acceptance:
#
#   epic export   a planted error: ticket 02 calls formatRow, which ticket 03 adds, yet its header says
#                 `Blocked by: —` and the waves table puts it in wave 1, before 03 (wave 2). The critic
#                 must name it with a fact (the ticket file and the line).
#   epic greet    no error: each ticket names the one before it in `Blocked by`, one wave each. The
#                 critic must answer Keep without invented objections.
#
# example.md next to this script is a review of the export plan in the format of agents/critic.md;
# test/contract/harness-evals.test.ts checks it against the graders and the line numbers below.
#
# Bash, not Node: it is test code; only the scripts the plugin ships must run without bash.
# Writes only into the current folder and $HOME.
set -euo pipefail

# The folder of this script, cut in bash rather than by dirname: a process start is slow in Git Bash
# (lib/demo-project.sh). Git Bash may spell it with `\`.
here=.
case "$0" in */* | *\\*) here="${0%[/\\]*}" ;; esac
bash "$here/../lib/demo-project.sh" local-green none

# The run's HOME is empty: git has no identity there, and the fixture must not depend on one.
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.invalid
export GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@example.invalid
export GIT_AUTHOR_DATE=2026-10-01T12:00:00Z GIT_COMMITTER_DATE=2026-10-01T12:00:00Z
# No `git maintenance run --auto` after each commit, and files written without a process each: as
# in lib/demo-project.sh, which explains both.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=maintenance.auto GIT_CONFIG_VALUE_0=false
put() {
    local text
    IFS= read -r -d '' text || true
    printf '%s' "$text" >"$1"
}

mkdir -p .scratch/export/issues .scratch/greet/issues

# --- epic export: ticket 02 waits for ticket 03 and does not say so ---------------------------
put .scratch/export/spec.md <<'EOF'
# Epic export — the sums as CSV

The demo project gets an `export` command: `node src/export.mjs rows.json` prints one CSV line per
row of the JSON file, cells escaped the CSV way.

## What we build

1. `src/csv.mjs` exports `escapeCell(value)`: a cell with a comma, a quote or a line break goes in
   double quotes, its quotes doubled.
2. `src/export.mjs` is the command: it reads the JSON file and prints `formatRow(row)` for each row.
3. `src/row.mjs` exports `formatRow(cells)`: the cells through `escapeCell`, joined by commas.

## Waves

| Ticket | Files of "Where in the code" | Wave |
| --- | --- | --- |
| 01 | src/csv.mjs, test/csv.test.mjs | 1 |
| 02 | src/export.mjs, test/export.test.mjs | 1 |
| 03 | src/row.mjs, test/row.test.mjs | 2 |

## Out of scope

Other separators, a header row, reading CSV.
EOF

put .scratch/export/issues/01-csv-escape.md <<'EOF'
# 01 — Escape a CSV cell

Type: task
Status: open
Blocked by: —

## What we do

`src/csv.mjs` exports `escapeCell(value)`: a cell with a comma, a quote or a line break goes in
double quotes, its quotes doubled; any other cell stays as it is.

## Done when

- [ ] `escapeCell('a,b')` returns `"a,b"`; `escapeCell('say "hi"')` returns `"say ""hi"""`; a test in
      `test/csv.test.mjs`.
- [ ] `node --test` — exit code 0.

## Where in the code

- `src/csv.mjs` — new
- `test/csv.test.mjs` — new
EOF

put .scratch/export/issues/02-export-command.md <<'EOF'
# 02 — The export command

Type: task
Status: open
Blocked by: —

## What we do

`src/export.mjs` runs as a command: `node src/export.mjs rows.json` reads the JSON array of rows and
prints `formatRow(row)` for each row, one line each. `formatRow` is imported from `src/row.mjs`.

## Done when

- [ ] A test starts the command on a file of two rows and reads two CSV lines.
- [ ] `node --test` — exit code 0.

## Where in the code

- `src/export.mjs` — new
- `test/export.test.mjs` — new
EOF

put .scratch/export/issues/03-row-format.md <<'EOF'
# 03 — Format a CSV row

Type: task
Status: open
Blocked by: 01

## What we do

`src/row.mjs` exports `formatRow(cells)`: each cell through `escapeCell` of `src/csv.mjs`, joined by
commas.

## Done when

- [ ] `formatRow(['a', 'b,c'])` returns `a,"b,c"`; a test in `test/row.test.mjs`.
- [ ] `node --test` — exit code 0.

## Where in the code

- `src/row.mjs` — new
- `test/row.test.mjs` — new
EOF

# --- epic greet: each ticket waits for the one before it and says so ---------------------------
put .scratch/greet/spec.md <<'EOF'
# Epic greet — a greeting command

The demo project gets a `greet` command: `node src/greet.mjs Ann` prints `Hello, Ann!`.

## What we build

1. `src/greet.mjs` exports `greeting(name)`, which returns `Hello, <name>!`, with a test.
2. The same file runs as a command: `node src/greet.mjs <name>` prints the greeting; with no name
   it prints `Hello, world!`. A test starts the command and reads its output.
3. `--shout` prints the greeting in capitals: `node src/greet.mjs Ann --shout` prints `HELLO, ANN!`.

## Waves

| Ticket | Files of "Where in the code" | Wave |
| --- | --- | --- |
| 01 | src/greet.mjs, test/greet.test.mjs | 1 |
| 02 | src/greet.mjs, test/greet-command.test.mjs | 2 |
| 03 | src/greet.mjs, test/greet-command.test.mjs | 3 |

## Out of scope

Translations, colours, a config file.
EOF

put .scratch/greet/issues/01-greeting.md <<'EOF'
# 01 — The greeting

Type: task
Status: open
Blocked by: —

## What we do

`src/greet.mjs` exports `greeting(name)`, which returns `Hello, <name>!`.

## Done when

- [ ] `greeting('Ann')` returns `Hello, Ann!`; a test in `test/greet.test.mjs`.
- [ ] `node --test` — exit code 0.

## Where in the code

- `src/greet.mjs` — new
- `test/greet.test.mjs` — new
EOF

put .scratch/greet/issues/02-greet-command.md <<'EOF'
# 02 — The greet command

Type: task
Status: open
Blocked by: 01

## What we do

`src/greet.mjs` also runs as a command: `node src/greet.mjs <name>` prints `greeting(name)`; with no
name it prints `Hello, world!`.

## Done when

- [ ] A test in `test/greet-command.test.mjs` starts the command with `Ann` and with no name and reads
      both lines.
- [ ] `node --test` — exit code 0.

## Where in the code

- `src/greet.mjs`
- `test/greet-command.test.mjs` — new
EOF

put .scratch/greet/issues/03-shout.md <<'EOF'
# 03 — Shout

Type: task
Status: open
Blocked by: 02

## What we do

The command of ticket 02 takes `--shout`: `node src/greet.mjs Ann --shout` prints `HELLO, ANN!`.

## Done when

- [ ] A test in `test/greet-command.test.mjs` starts the command with `Ann --shout` and reads
      `HELLO, ANN!`.
- [ ] `node --test` — exit code 0.

## Where in the code

- `src/greet.mjs`
- `test/greet-command.test.mjs`
EOF

git add .scratch/export .scratch/greet
git commit -q -m "export, greet: plans for acceptance"
git push -q origin main
