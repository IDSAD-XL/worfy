#!/usr/bin/env bash
# Fixture of the case: project demo with the open pull request octo-org/ledger#7 of ../pr-reply-fixture/pull.sh, and
# ../pr-fix-checks/fixture/pr-fix.cjs in mode conflicts on top — a commit on main whose change of src/sum.mjs conflicts
# with the head of the pull request, the checks CI gave that head before, a push guard, and the profile in
# Full mode. The stand-in gh answers offline and logs every call to gh-calls.log; no git command reaches the
# network, and every push to a GitHub address lands in the bare repository of the fixture.
#
# Bash, not Node: it is test code; only the scripts the plugin ships must run without bash.
# Writes only into the current folder and $HOME.
set -euo pipefail

# The folder of this script, cut in bash rather than by dirname: a process start is slow in Git Bash
# (lib/demo-project.sh). Git Bash may spell it with `\`.
here=.
case "$0" in */* | *\\*) here="${0%[/\\]*}" ;; esac
bash "$here/../pr-reply-fixture/pull.sh"

# The run's HOME is empty: git has no identity there. Fixed dates keep the commit on main the same on every build.
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.invalid
export GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@example.invalid
export GIT_AUTHOR_DATE=2026-10-03T08:00:00Z GIT_COMMITTER_DATE=2026-10-03T08:00:00Z
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=maintenance.auto GIT_CONFIG_VALUE_0=false
node "$here/../pr-fix-checks/fixture/pr-fix.cjs" conflicts full
