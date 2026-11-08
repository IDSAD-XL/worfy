#!/usr/bin/env bash
# Fixture of the case: project demo, finish local-green, no variant (harness/evals/lib/demo-project.sh),
# and on top of it, committed on main and pushed to origin, two plans that wait for acceptance:
#
#   epic export   a planted error: ticket 02 calls formatRow, which ticket 03 adds, yet its header says
#                 `Blocked by: —` and the waves table puts it in wave 1, before 03 (wave 2). The critic
#                 must name it with a fact (the ticket file and the line).
#   epic greet    no error: each ticket names the one before it in `Blocked by`, one wave each. The
#                 critic must answer Keep without invented objections.
#   epic limit    a duplicate: it adds `limit(n, low, high)`, and src/clamp.mjs, committed months
#                 earlier, already has `clamp(value, min, max)`. The critic must name src/clamp.mjs with
#                 a line and not pass the plan without a reservation.
#   epic sum-guard  a cheaper alternative: it builds a checker script and a hook installer to stop a
#                 broken sum before a commit, and the project already has test/sum.test.mjs and a
#                 pre-commit hook (.githooks/pre-commit) that runs every test. The alternative of the
#                 review must name that check.
#   epic sum-output a changed condition: ADR-0001 deferred a JSON output of sum-cli because no program
#                 read it, "revisit when a program reads the output"; the plan says two programs do now,
#                 and still keeps JSON out of scope by that ADR. The critic must propose revisiting
#                 ADR-0001 and cite it.
#
# The existing feature, check and decision go in one commit before the plans, dated months earlier.
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

# --- the history: a feature, a check and a decision the plans below run into -------------------
mkdir -p .githooks docs/adr
put src/clamp.mjs <<'EOF'
/** Keeps value within min..max: below min it returns min, above max it returns max. */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}
EOF
put test/clamp.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clamp } from '../src/clamp.mjs'

test('clamp keeps a value within the range', () => {
  assert.equal(clamp(-1, 0, 3), 0)
  assert.equal(clamp(5, 0, 3), 3)
  assert.equal(clamp(2, 0, 3), 2)
})
EOF
put src/sum-cli.mjs <<'EOF'
import { sum } from './sum.mjs'

// `node src/sum-cli.mjs 2 3` prints `sum: 5`: plain text only (ADR-0001).
const [a, b] = process.argv.slice(2).map(Number)
console.log(`sum: ${sum(a, b)}`)
EOF
put .githooks/pre-commit <<'EOF'
#!/bin/sh
# Runs every test before a commit and refuses the commit when one fails (README.md: setup).
exec node --test
EOF
put README.md <<'EOF'
# demo

`src/sum.mjs` adds two numbers, `src/clamp.mjs` keeps a number within a range, and
`node src/sum-cli.mjs 2 3` prints `sum: 5`.

## Setup

Run `git config core.hooksPath .githooks` once after cloning: the pre-commit hook runs `node --test`
before each commit and refuses a commit with a failing test.
EOF
put docs/adr/0001-sum-cli-prints-plain-text.md <<'EOF'
# 0001 — sum-cli prints plain text, no JSON

Date: 2026-05-20. Status: accepted.

## Context

`node src/sum-cli.mjs 2 3` prints `sum: 5`. A `--json` output was proposed. The command has one
user, Ann, who reads the result by eye; no program reads it.

## Decision

The command prints plain text only. `--json` is deferred: with no program reading the output, a
machine format would have no reader, only one more format to keep stable.

## Revisit when

A program, not a person, reads the output of `sum-cli`.
EOF
chmod +x .githooks/pre-commit
git add src test .githooks README.md docs
GIT_AUTHOR_DATE=2026-06-01T12:00:00Z GIT_COMMITTER_DATE=2026-06-01T12:00:00Z \
    git commit -q -m "clamp, sum-cli, a pre-commit hook and ADR-0001"

mkdir -p .scratch/export/issues .scratch/greet/issues .scratch/limit/issues .scratch/sum-guard/issues .scratch/sum-output/issues

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

# --- epic limit: adds what src/clamp.mjs already does -------------------------------------------
put .scratch/limit/spec.md <<'EOF'
# Epic limit — keep a number within a range

Readings of the sensor sometimes fall outside the range they should have. The demo project gets
`limit(n, low, high)`: below `low` it returns `low`, above `high` it returns `high`, otherwise `n`.

## What we build

1. `src/limit.mjs` exports `limit(n, low, high)`, with a test.
2. `src/sum.mjs` gets `sumLimited(a, b, low, high)`: the sum of `a` and `b` through `limit`.

## Waves

| Ticket | Files of "Where in the code" | Wave |
| --- | --- | --- |
| 01 | src/limit.mjs, test/limit.test.mjs | 1 |
| 02 | src/sum.mjs, test/sum.test.mjs | 2 |

## Out of scope

Ranges with an open end, rounding.
EOF

put .scratch/limit/issues/01-limit.md <<'EOF'
# 01 — Keep a number within a range

Type: task
Status: open
Blocked by: —

## What we do

`src/limit.mjs` exports `limit(n, low, high)`: below `low` it returns `low`, above `high` it returns
`high`, otherwise `n`.

## Done when

- [ ] `limit(-1, 0, 3)` returns `0`, `limit(5, 0, 3)` returns `3`, `limit(2, 0, 3)` returns `2`; a test
      in `test/limit.test.mjs`.
- [ ] `node --test` — exit code 0.

## Where in the code

- `src/limit.mjs` — new
- `test/limit.test.mjs` — new
EOF

put .scratch/limit/issues/02-sum-limited.md <<'EOF'
# 02 — A sum within a range

Type: task
Status: open
Blocked by: 01

## What we do

`src/sum.mjs` exports `sumLimited(a, b, low, high)`: `limit(sum(a, b), low, high)`, `limit` imported
from `src/limit.mjs`.

## Done when

- [ ] `sumLimited(2, 3, 0, 4)` returns `4`; a test in `test/sum.test.mjs`.
- [ ] `node --test` — exit code 0.

## Where in the code

- `src/sum.mjs`
- `test/sum.test.mjs`
EOF

# --- epic sum-guard: builds a checker the test and the pre-commit hook already are -----------------
put .scratch/sum-guard/spec.md <<'EOF'
# Epic sum-guard — stop a broken sum before it is committed

Last month a change to `src/sum.mjs` that returned a string for two numbers (`sum(2, 3)` gave `'23'`)
was committed and found a week later. This epic builds a checker that runs before each commit.

## What we build

1. `checks/sum-cases.json` holds inputs and the expected sums; `scripts/verify-sum.mjs` runs `sum`
   over the table and exits 1 on the first mismatch or on a result that is not a number.
2. `scripts/install-hook.mjs` writes `.git/hooks/pre-commit`, which runs `node scripts/verify-sum.mjs`
   and refuses the commit when it exits 1.
3. A test of the installer: it writes the hook, and the hook refuses a commit with a broken sum.

## Waves

| Ticket | Files of "Where in the code" | Wave |
| --- | --- | --- |
| 01 | checks/sum-cases.json, scripts/verify-sum.mjs | 1 |
| 02 | scripts/install-hook.mjs | 2 |
| 03 | test/install-hook.test.mjs | 3 |

## Out of scope

Checks of functions other than `sum`.
EOF

put .scratch/sum-guard/issues/01-verify-sum.md <<'EOF'
# 01 — A table of sums and its checker

Type: task
Status: open
Blocked by: —

## What we do

`checks/sum-cases.json` lists inputs and expected sums; `scripts/verify-sum.mjs` runs `sum` of
`src/sum.mjs` over it and exits 1 on the first mismatch or on a result that is not a number.

## Done when

- [ ] `node scripts/verify-sum.mjs` exits 0 on the current `sum` and 1 on a `sum` that returns a string.

## Where in the code

- `checks/sum-cases.json` — new
- `scripts/verify-sum.mjs` — new
EOF

put .scratch/sum-guard/issues/02-install-hook.md <<'EOF'
# 02 — Install the pre-commit hook

Type: task
Status: open
Blocked by: 01

## What we do

`node scripts/install-hook.mjs` writes `.git/hooks/pre-commit`, which runs
`node scripts/verify-sum.mjs` and refuses the commit when it exits 1.

## Done when

- [ ] After `node scripts/install-hook.mjs`, `.git/hooks/pre-commit` exists and is executable.

## Where in the code

- `scripts/install-hook.mjs` — new
EOF

put .scratch/sum-guard/issues/03-hook-test.md <<'EOF'
# 03 — Test the hook

Type: task
Status: open
Blocked by: 02

## What we do

A test makes a temporary repository, installs the hook there, breaks `sum` and checks that the commit
is refused.

## Done when

- [ ] `test/install-hook.test.mjs` passes; `node --test` — exit code 0.

## Where in the code

- `test/install-hook.test.mjs` — new
EOF

# --- epic sum-output: two programs read the output now, JSON stays out by ADR-0001 -----------------
put .scratch/sum-output/spec.md <<'EOF'
# Epic sum-output — keep the output of sum-cli stable

Since September two programs read the output of `node src/sum-cli.mjs`: Bob's dashboard and Carol's
alert script, each with a regular expression for `sum: <n>`. On 2026-09-28 a change of the wording to
`total: 5` broke both until it was reverted.

## What we build

1. A test that starts `node src/sum-cli.mjs 2 3` and expects exactly the line `sum: 5`.
2. A comment above the `console.log` of `src/sum-cli.mjs`: programs read this line, do not change it.

## Waves

| Ticket | Files of "Where in the code" | Wave |
| --- | --- | --- |
| 01 | test/sum-cli.test.mjs | 1 |
| 02 | src/sum-cli.mjs | 1 |

## Out of scope

A JSON output: deferred by ADR-0001 (`docs/adr/0001-sum-cli-prints-plain-text.md`).
EOF

put .scratch/sum-output/issues/01-pin-output.md <<'EOF'
# 01 — Pin the output line

Type: task
Status: open
Blocked by: —

## What we do

`test/sum-cli.test.mjs` starts `node src/sum-cli.mjs 2 3` and expects its output to be exactly the
line `sum: 5`.

## Done when

- [ ] The test passes on the current command and fails when the wording changes.
- [ ] `node --test` — exit code 0.

## Where in the code

- `test/sum-cli.test.mjs` — new
EOF

put .scratch/sum-output/issues/02-warn-in-code.md <<'EOF'
# 02 — Warn in the code

Type: task
Status: open
Blocked by: —

## What we do

A comment above the `console.log` of `src/sum-cli.mjs`: Bob's dashboard and Carol's alert script read
this line with a regular expression; do not change its wording.

## Done when

- [ ] The comment is there; `node --test` — exit code 0.

## Where in the code

- `src/sum-cli.mjs`
EOF

git add .scratch
git commit -q -m "plans for acceptance"
git push -q origin main
