#!/usr/bin/env bash
# Fixture of the case: project demo with the invented review history `short` of
# ../human-review-setup-fixture/history.sh — 3 pull requests of quillwork/ledger with 8 substantive
# comments of the team, too few for a voice (30).
# The stand-in gh answers offline and logs every call to gh-calls.log; no git command reaches the network.
#
# Bash, not Node: it is test code; only the scripts the plugin ships must run without bash.
# Writes only into the current folder and $HOME.
set -euo pipefail

# The folder of this script, cut in bash rather than by dirname: a process start is slow in Git Bash
# (lib/demo-project.sh). Git Bash may spell it with `\`.
here=.
case "$0" in */* | *\\*) here="${0%[/\\]*}" ;; esac
bash "$here/../human-review-setup-fixture/history.sh" short
