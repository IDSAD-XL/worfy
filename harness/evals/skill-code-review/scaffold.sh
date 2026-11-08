#!/usr/bin/env bash
# Fixture of the case: project demo, finish local-green, no variant (harness/evals/lib/demo-project.sh),
# and on top of it a change for /worfy:code-review to review on both of its axes:
#
#   main, pushed to origin   CODING_STANDARDS.md: named exports only, a JSDoc line over every
#                            exported function. Ticket 01 asks for src/alpha.mjs exporting
#                            double(n), which returns n * 2, with a test in test/alpha.test.mjs.
#   demo/01, checked out     one commit: src/alpha.mjs with `export default function double(n)`
#                            and no JSDoc line — two breaches of CODING_STANDARDS.md (the Standards
#                            axis) — and no test/alpha.test.mjs, which the ticket asks for (the Spec
#                            axis). double itself returns n * 2.
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
# No `git maintenance run --auto` after each commit, as in lib/demo-project.sh.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=maintenance.auto GIT_CONFIG_VALUE_0=false

# --- main: the coding standards of the project ---------------------------------------------
cat >CODING_STANDARDS.md <<'STANDARDS'
# Coding standards

1. Named exports only: no `export default`.
2. Every exported function has a one-line JSDoc comment (`/** … */`) right above it.
3. Every module in `src/` has its tests in `test/<module>.test.mjs`.
STANDARDS
git add CODING_STANDARDS.md
git commit -q -m "Coding standards"
git push -q origin main

# --- demo/01: the change under review --------------------------------------------------------
git checkout -q -b demo/01
cat >src/alpha.mjs <<'CODE'
export default function double(n) {
  return n * 2
}
CODE
git add src/alpha.mjs
git commit -q -m "demo/01: double"
