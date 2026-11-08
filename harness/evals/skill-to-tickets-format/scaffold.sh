#!/usr/bin/env bash
# Fixture of the case: project demo, finish local-green, no variant (harness/evals/lib/demo-project.sh),
# and on top of it, committed on main and pushed to origin, the spec of a new epic `greet` with no
# tickets yet: the plan /worfy:to-tickets breaks into tickets.
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

mkdir -p .scratch/greet
cat >.scratch/greet/spec.md <<'SPEC'
# Epic greet — a greeting command

## Goal

The demo project gets a `greet` command: `node src/greet.mjs Ann` prints `Hello, Ann!`.

## What we build

1. `src/greet.mjs` exports `greeting(name)`, which returns `Hello, <name>!`, with a test.
2. The same file runs as a command: `node src/greet.mjs <name>` prints the greeting; with no name
   it prints `Hello, world!`. A test starts the command and reads its output.
3. `--shout` prints the greeting in capitals: `node src/greet.mjs Ann --shout` prints `HELLO, ANN!`.
   It needs the command of item 2.

## Out of scope

Translations, colours, a config file.
SPEC
git add .scratch/greet/spec.md
git commit -q -m "greet: spec"
git push -q origin main
