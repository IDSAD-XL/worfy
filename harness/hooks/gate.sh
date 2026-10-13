#!/usr/bin/env bash
# The old name of the quality gate. The gate is gate.mjs, run by node (worfy-windows ticket 03);
# this file starts it with the same arguments and stdin and ends with its exit code.
#
# Why it is here: a profile moved from the old Harness names this file in commands.verify and in
# rules.md ("bash ~/.claude/worfy-harness/plugin/hooks/gate.sh full"), and agents run that line as
# it is written. Nothing in the Harness calls this file: hooks, skills, agents and bin/ name
# gate.mjs, and so does a new profile ("node …/hooks/gate.mjs").
#
# worfy-windows ticket 46 removes it: the move then writes "node … gate.mjs" into a profile, and
# the installer rewrites the profiles already moved.
#
# Without node the answer is the one gate.sh always gave: the "could not verify" line and exit 3.
command -v node >/dev/null 2>&1 || { echo "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: node не найден" >&2; exit 3; }
# `pwd -W` is Git Bash on Windows: C:/…, a path node reads with no help from the shell.
exec node "$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && { pwd -W 2>/dev/null || pwd -P; })/gate.mjs" "$@"
