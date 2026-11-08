#!/usr/bin/env bash
# Fixture of the case: project demo, finish local-green, no variant (harness/evals/lib/demo-project.sh),
# and on top of it, committed on main and pushed to origin, what /worfy:product-ideas reads:
#
#   docs/roadmap.md              the roadmap: epic demo now, epic docs next, epic bigint later, and
#                                no command-line tool. An idea against the roadmap names one of them.
#   docs/product/growth/map.md   the map of the product topic `growth`: what demo does after epic demo.
#
# The case runs without the worfy-mind-map server, which the eval runner does not start: the skill
# then gives the ideas in the reply and says they are not on the Mind map.
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

mkdir -p docs/product/growth
cat >docs/roadmap.md <<'ROADMAP'
# Roadmap of demo

Status: accepted by the owner 2026-09-20

demo is a small arithmetic library for a weekly coding club, where beginners learn to write tests
in JavaScript. The teacher hands out one function at a time; the students read it and its test.

## Now: epic demo

Four functions, one ticket each: double, square, negate and triple (`.scratch/demo/`).

## Next: epic docs

A README section for every function, with one example call. Starts after epic demo.

## Later: epic bigint

BigInt support in every function, so that `double(2n)` works. Planned for the next quarter.

## Not planned

- A command-line tool: demo stays a library the students import.
ROADMAP

cat >docs/product/growth/map.md <<'MAP'
# growth: what demo does after epic demo

## Destination

The owner knows which epic follows epic demo, and why.

## Notes

- The club meets once a week; twelve students came to the last meeting.
- The teacher asked twice for exercises where the student fixes a failing test, not reads a passing one.

## Decisions so far

None yet.

## Not yet specified

- Whether epic docs or epic bigint helps the students more.
MAP

git add docs
git commit -q -m "Roadmap and the product topic growth"
git push -q origin main
