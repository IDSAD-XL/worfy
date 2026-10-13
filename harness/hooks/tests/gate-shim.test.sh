#!/usr/bin/env bash
# Tests of gate.sh, the old name of the gate (worfy-windows ticket 03): the file starts gate.mjs
# and adds nothing of its own. One run through `node gate.mjs` and one through `bash gate.sh` give
# the same exit code, the same "[gate] …" lines and the same files in the state folder:
#   - green, red and not registered, and the profile argument reaches the gate (fast, full);
#   - stdin reaches the gate: the session of the hook JSON is in the name of the marker;
#   - the file finds gate.mjs through a symlink to itself (not on Windows: Git Bash copies a file
#     instead of linking it);
#   - without node: the "could not verify" line and exit code 3, as gate.sh always answered.
# Run: bash harness/hooks/tests/gate-shim.test.sh; exit code 0 means everything passed.
# HOOKS_DIR runs the test on another copy of the hooks.
#
# The registry, the state folders and the repositories are temporary (CLAUDE_GATE_CONFIG,
# CLAUDE_GATE_STATE): the test does not touch the live registry or markers.
set -u
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads.
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
HOOKS="${HOOKS_DIR:-$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })}"   # the hooks next to this test (harness/hooks)
GATE="$HOOKS/gate.mjs"
SHIM="$HOOKS/gate.sh"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
unset CLAUDE_CODE_SESSION_ID GATE_SCOPE HARNESS_HOME
T="$(mktemp -d)" || exit 1
[ -d "$T" ] || exit 1
T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
export CLAUDE_GATE_CONFIG="$T/config.json"
mkdir -p "$T/state-new" "$T/state-old" "$T/none"

# --- fixtures ---------------------------------------------------------------------
# The gate runs "$PM run <script>"; pm is this file, so the test needs no npm. $T/mode says how
# the script ends: ok or bad (a real test failure). On Windows the file is a .cmd: node starts
# nothing else there without an interpreter.
if [ "$WIN" -eq 1 ]; then
    PM="$T/fakepm.cmd"
    printf '@echo off\r\nset /p m=<"%%~dp0mode"\r\nif "%%m%%"=="ok" exit /b 0\r\necho Tests 1 failed\r\nexit /b 1\r\n' >"$PM"
else
    PM="$T/fakepm"
    printf '#!/bin/sh\n[ "$(cat "%s/mode")" = ok ] && exit 0\necho "Tests 1 failed"\nexit 1\n' "$T" >"$PM"
    chmod +x "$PM"
fi
mode() { echo "$1" >"$T/mode"; }
newrepo() { # $1 = path: a repository with one commit and origin/main at it
    mkdir -p "$1"
    git -C "$1" init -q -b main
    echo '{ "name": "fixture", "scripts": { "check": "true" } }' >"$1/package.json"
    git -C "$1" add package.json
    git -C "$1" -c user.email=t@t -c user.name=t commit -q -m init
    git -C "$1" update-ref refs/remotes/origin/main HEAD
}
R="$T/reg"      # registered, key "t"
U="$T/unreg"    # not registered
newrepo "$R"; newrepo "$U"
jq -n --arg r "$R" --arg pm "$PM" '{repos: [{key: "t", match: $r, pm: $pm, root: {fast: ["check"], full: ["check"]}, workspace: {}}]}' >"$CLAUDE_GATE_CONFIG"

# both <stdin> <repository> <arguments…>: the same run by the new name and by the old one. Each
# has a state folder of its own, so the second run is no cache hit of the first.
both() {
    local input="$1" repo="$2"; shift 2
    out_new="$(cd "$repo" && printf '%s' "$input" | CLAUDE_GATE_STATE="$T/state-new" GATE_SCOPE=all node "$GATE" "$@" 2>&1)"; rc_new=$?
    out_old="$(cd "$repo" && printf '%s' "$input" | CLAUDE_GATE_STATE="$T/state-old" GATE_SCOPE=all bash "$SHIM" "$@" 2>&1)"; rc_old=$?
}
gate_lines() { printf '%s\n' "$1" | tr -d '\r' | grep '^\[gate\]'; }
# same <description> <exit code> <a "[gate]" line both must print>
same() {
    if [ "$rc_new" -eq "$2" ] && [ "$rc_old" -eq "$2" ] && [ "$(gate_lines "$out_new")" = "$(gate_lines "$out_old")" ] && [[ "$out_old" == *"$3"* ]]; then ok "$1"
    else bad "$1 (gate.mjs: rc=$rc_new, out: ${out_new:0:200}; gate.sh: rc=$rc_old, out: ${out_old:0:200})"; fi
}

# --- 1. The same answer by both names ------------------------------------------------
mode ok
both "" "$R" fast
same "green: exit 0 and the same lines by both names" 0 "[gate] зелено (fast): t/.:check"
mode bad
both "" "$R" full
same "red, and the profile argument is passed on: exit 2 and «красно (full)» by both names" 2 "[gate] красно (full): t/.:check"
mode ok
both '{"session_id":"shim session/1"}' "$U" fast
same "not registered: exit 3 and the same lines by both names" 3 "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ"

# --- 2. stdin is passed on, and the state folder is left the same ---------------------
if [ -n "$(find "$T/state-old" -maxdepth 1 -type f -name 'nokey-*-shim_session_1')" ]; then ok "stdin reaches the gate: the marker carries the session of the hook JSON"
else bad "no marker of the session in the state folder: $(ls "$T/state-old")"; fi
if [ "$(ls "$T/state-new")" = "$(ls "$T/state-old")" ] && [ -n "$(ls "$T/state-old")" ]; then ok "the files of the state folder have the same names by both names"
else bad "state folders differ: gate.mjs: $(ls "$T/state-new" | tr '\n' ' '); gate.sh: $(ls "$T/state-old" | tr '\n' ' ')"; fi

# --- 3. Through a symlink ----------------------------------------------------------
if [ "$WIN" -eq 1 ]; then
    echo "skip the symlink check: Git Bash on Windows copies a file instead of linking it"
    # Git Bash turns /c/… into C:/… for a Windows program unless told not to; the file must give
    # node a path it reads either way.
    out="$(cd "$R" && MSYS_NO_PATHCONV=1 CLAUDE_GATE_STATE="$T/state-old" GATE_SCOPE=all bash "$SHIM" fast </dev/null 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] зелено (fast): t/.:check"* ]]; then ok "with path conversion of Git Bash off: gate.mjs is still found"
    else bad "with path conversion off: rc=$rc, out: ${out:0:300}"; fi
else
    ln -s "$SHIM" "$T/old-gate.sh"
    out="$(cd "$R" && CLAUDE_GATE_STATE="$T/state-old" GATE_SCOPE=all bash "$T/old-gate.sh" fast </dev/null 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] зелено (fast): t/.:check"* ]]; then ok "through a symlink to gate.sh: gate.mjs is found next to the real file"
    else bad "through a symlink: rc=$rc, out: ${out:0:300}"; fi
fi

# --- 4. Without node ---------------------------------------------------------------
# PATH is an empty folder: the file must answer with what bash has built in.
out="$(cd "$R" && PATH="$T/none" CLAUDE_GATE_STATE="$T/state-old" "$BASH" "$SHIM" fast </dev/null 2>&1)"; rc=$?
if [ "$rc" -eq 3 ] && [ "$(printf '%s' "$out" | tr -d '\r')" = "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: node не найден" ]; then ok "without node: the «ПРОВЕРИТЬ НЕ УДАЛОСЬ: node не найден» line and exit 3"
else bad "without node: rc=$rc, out: ${out:0:300}"; fi

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
