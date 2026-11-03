#!/usr/bin/env bash
# The Stop hook stop.mjs under Claude Code across one red-then-green cycle of the gate, in a
# registered worktree: a red gate run holds the turn (exit 2, the reason on stderr), and a later
# green run lets it end (exit 0, nothing said). The other tests check each half on its own: the red
# marker that holds a turn (harness-home.test.sh, gate-notverified.test.sh) and the green run that
# removes the marker (gate-verdict.test.sh); here the gate itself writes and removes it between two
# Stops of one session, as a session that fixes its work goes through it. The same guarantee on
# Codex is checked by the parity test of the app repository, on its fake app-server.
# Run: bash harness/hooks/tests/stop-gate-cycle.test.sh; exit code 0 means every check passed.
#
# The registry, the gate state, the worktree and HOME are temporary (CLAUDE_GATE_CONFIG,
# CLAUDE_GATE_STATE): the test does not touch the live registry or markers.
set -u
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads.
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
HOOKS="${HOOKS_DIR:-$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })}"   # HOOKS_DIR runs the test on another copy of the hooks
GATE="$HOOKS/gate.mjs"
STOP="$HOOKS/stop.mjs"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
# The session comes from the hook JSON; the session the test was started from does not count.
unset CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID GATE_SCOPE HARNESS_HOME CLAUDE_PROFILE_BIN
T="$(mktemp -d)" || exit 1
T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export HOME="$T/home" USERPROFILE="$T/home"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export CLAUDE_GATE_STATE="$T/state" CLAUDE_GATE_CONFIG="$T/config.json"
R="$T/reg"
mkdir -p "$T/home" "$T/state" "$R"
# The gate runs "$PM run check"; the script passes or fails by the first line of status.txt in the
# worktree, which the "session" edits. On Windows a .cmd: node starts nothing else there without an
# interpreter.
if [ "$WIN" -eq 1 ]; then
    PM="$T/fakepm.cmd"
    printf '@echo off\r\nset /p m=<"%s"\r\nif "%%m%%"=="ok" exit /b 0\r\necho Tests 1 failed\r\nexit /b 1\r\n' "$R/status.txt" >"$PM"
else
    PM="$T/fakepm"
    printf '#!/bin/sh\n[ "$(head -n 1 "%s")" = ok ] && exit 0\necho "Tests 1 failed"\nexit 1\n' "$R/status.txt" >"$PM"
    chmod +x "$PM"
fi
printf '{"repos":[{"key":"t","match":"%s","pm":"%s","root":{"fast":["check"]},"workspace":{}}]}\n' "$R" "$PM" >"$CLAUDE_GATE_CONFIG"
echo ok >"$R/status.txt"
# The gate runs the scripts a package declares: the root package has "check".
echo '{ "name": "fixture", "scripts": { "check": "true" } }' >"$R/package.json"
git -C "$R" init -q && git -C "$R" add status.txt package.json && git -C "$R" commit -q -m init

# A Stop of Claude Code: no turn_id, a transcript named after the session (hooks/codex-input.mjs).
stop_input="{\"session_id\":\"cycle-1\",\"transcript_path\":\"$T/cycle-1.jsonl\",\"cwd\":\"$R\",\"hook_event_name\":\"Stop\",\"stop_hook_active\":false}"
stop() { (cd "$R" && printf '%s' "$stop_input" | node "$STOP" >"$T/out" 2>"$T/err"); rc=$?; }

# --- 1. The session breaks its work: the gate is red, the Stop holds the turn with the reason --------
echo bad >"$R/status.txt"
out="$(cd "$R" && printf '{"session_id":"cycle-1"}' | GATE_SCOPE=all node "$GATE" fast 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && ok "red work: gate fast exits 2" || bad "red work: gate fast exit $rc, out: ${out:0:300}"
stop
if [ "$rc" -eq 2 ] && [[ "$(cat "$T/err")" == "The quality gate is red"* ]] && [ ! -s "$T/out" ]; then
    ok "red gate: Stop exits 2 with the reason on stderr, the turn goes on"
else bad "red gate: Stop exit $rc, stdout: $(head -c 200 "$T/out"), stderr: $(head -c 300 "$T/err")"; fi

# --- 2. The session fixes it: the gate is green, the next Stop lets the turn end, saying nothing -----
echo ok >"$R/status.txt"
out="$(cd "$R" && printf '{"session_id":"cycle-1"}' | GATE_SCOPE=all node "$GATE" fast 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [[ "$out" == *"[gate] green"* ]] && ok "fixed work: gate fast is green" || bad "fixed work: gate fast exit $rc, out: ${out:0:300}"
stop
if [ "$rc" -eq 0 ] && [ ! -s "$T/out" ] && [ ! -s "$T/err" ]; then ok "green gate: Stop exits 0 and says nothing, the turn ends"
else bad "green gate: Stop exit $rc, stdout: $(head -c 200 "$T/out"), stderr: $(head -c 300 "$T/err")"; fi

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
