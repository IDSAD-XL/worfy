#!/usr/bin/env bash
# pull.sh — the fixture of the pr-reply-* eval cases: project demo (harness/evals/lib/demo-project.sh) with one open
# pull request on GitHub, octo-org/ledger#7, answered offline: its head commit in the repository, never checked out,
# and five review threads — three wait for the author's answer, one is resolved, one the author answered last.
#
# pull.cjs next to this script does the work: the head commit, the origin on GitHub, and the stand-in gh in
# .git/eval-gh/ first on the PATH of the run's shells. Every login, name and text is invented.
#
# Bash, not Node, as every scaffold: it is test code; only the scripts the plugin ships must run without bash.
# Writes only into the current folder and $HOME.
set -euo pipefail

# The folder of this script, cut in bash rather than by dirname: a process start is slow in Git Bash
# (lib/demo-project.sh). Git Bash may spell it with `\`.
here=.
case "${BASH_SOURCE[0]}" in */* | *\\*) here="${BASH_SOURCE[0]%[/\\]*}" ;; esac
bash "$here/../lib/demo-project.sh" local-green none

# The run's HOME is empty: git has no identity there, and the fixture must not depend on one. Fixed dates keep the
# head commit, and so the sha the answers name, the same on every build.
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.invalid
export GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@example.invalid
export GIT_AUTHOR_DATE=2026-10-01T12:00:00Z GIT_COMMITTER_DATE=2026-10-01T12:00:00Z
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=maintenance.auto GIT_CONFIG_VALUE_0=false

node "$here/pull.cjs"
