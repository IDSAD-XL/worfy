#!/usr/bin/env bash
# history.sh <short|full|refresh> — the fixture of the human-review-setup-* eval cases: project demo
# (harness/evals/lib/demo-project.sh) with an invented review history on GitHub, answered offline.
#
#   short    3 pull requests with 8 substantive comments of the team: too little for a voice (30)
#   full     12 merged pull requests with 34 substantive comments of three reviewers, in three areas
#            (src/, migrations/, docs/), each pull request a commit in the repository
#   refresh  full, plus the private folder of a reviewer built and kept 13 days ago: research.md, the
#            installed skill, lint.json, check/, and meta.json whose fetched_at the update reads from
#
# history.cjs next to this script does the work: the commits, the origin on GitHub, the stand-in gh in
# .git/eval-gh/ first on the PATH of the run's shells, and the private folder of refresh. Every login,
# name and text of the history is invented (team quillwork, repository quillwork/ledger).
#
# Bash, not Node, as every scaffold: it is test code; only the scripts the plugin ships must run without
# bash. Writes only into the current folder and $HOME.
set -euo pipefail

kind="${1:-}"
case "$kind" in short | full | refresh) ;; *) echo "usage: history.sh <short|full|refresh>" >&2; exit 2 ;; esac

# The folder of this script, cut in bash rather than by dirname: a process start is slow in Git Bash
# (lib/demo-project.sh). Git Bash may spell it with `\`.
here=.
case "${BASH_SOURCE[0]}" in */* | *\\*) here="${BASH_SOURCE[0]%[/\\]*}" ;; esac
bash "$here/../lib/demo-project.sh" local-green none

# The run's HOME is empty: git has no identity there, and the fixture must not depend on one. Fixed
# dates keep the commits, and so the shas the history names, the same on every build.
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.invalid
export GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@example.invalid
export GIT_AUTHOR_DATE=2026-10-01T12:00:00Z GIT_COMMITTER_DATE=2026-10-01T12:00:00Z
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=maintenance.auto GIT_CONFIG_VALUE_0=false

# The Harness state folders of the run, as lib/demo-project.sh chooses them: the one hooks/eval-env.cjs
# names for EVAL_HARNESS_HOME (worfy-harness when unset), and $HOME/.claude/worfy-harness when it is unset.
state="$(unset HARNESS_HOME; EVAL_HARNESS_HOME="${EVAL_HARNESS_HOME:-worfy-harness}" exec node "$here/../../hooks/eval-env.cjs" harness-home)"
homes=("$state")
[ -n "${EVAL_HARNESS_HOME:-}" ] || homes+=("$HOME/.claude/worfy-harness")
node "$here/history.cjs" "$kind" "${homes[@]}"
