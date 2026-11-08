#!/usr/bin/env bash
# Fixture of the case: project demo with the invented review history `refresh` of
# ../human-review-setup-fixture/history.sh — 12 pull requests, and a reviewer built and kept 13 days ago in the private folder; 4 pull requests are newer than its fetched_at.
# The stand-in gh answers offline and logs every call to gh-calls.log; no git command reaches the network.
#
# Bash, not Node: it is test code; only the scripts the plugin ships must run without bash.
# Writes only into the current folder and $HOME.
set -euo pipefail

# The folder of this script, cut in bash rather than by dirname: a process start is slow in Git Bash
# (lib/demo-project.sh). Git Bash may spell it with `\`.
here=.
case "$0" in */* | *\\*) here="${0%[/\\]*}" ;; esac
bash "$here/../human-review-setup-fixture/history.sh" refresh
