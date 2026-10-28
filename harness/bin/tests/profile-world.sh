# The common part of the tests of harness/bin/profile, sourced by profile.test.sh, profile-schema2.test.sh,
# profile-attribution.test.sh and profile-user.test.sh after `set -u`: the scripts under test, check(), the snapshot of
# the real home and the temporary directory. Not a test of its own (no .test.sh).
#
# The scripts under test are the copies next to this test (harness/); BIN_DIR and HOOKS_DIR
# point it at another copy. Live checks run only when the live gate registry exists, and only for
# the registered projects whose directories exist: $HARNESS_HOME/gate/config.json, or during the
# transition the legacy ~/.claude/gate/config.json, which profile reads when the new one is missing.
HARNESS="$(cd "$HERE/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
HOOKS="${HOOKS_DIR:-$HARNESS/hooks}"
PROFILE="$BIN/profile"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
LIVE_GATE="${HARNESS_HOME:-$HOME/.claude/worfy-harness}/gate/config.json"
[ -f "$LIVE_GATE" ] || LIVE_GATE="$HOME/.claude/gate/config.json"
pass=0
fail=0
# The real ~/.claude (the Harness parts) and ~/.claude/worfy-harness: compared at the end (real-home.sh).
. "$HERE/real-home.sh"
REAL_HOME="$HOME"
home_before="$(real_home_snapshot "$REAL_HOME")"

check() { # $1 name, $2 expected exit code, $3 expected stdout substring (or ""), then the command
    local name="$1" want_rc="$2" want_out="$3"
    shift 3
    local got rc
    got="$("$@" 2>/tmp/profile-test-err.$$)"
    rc=$?
    if [ "$rc" -eq "$want_rc" ] && { [ -z "$want_out" ] || [[ "$got" == *"$want_out"* ]]; }; then
        pass=$((pass + 1))
        echo "ok   $name (exit $rc)"
    else
        fail=$((fail + 1))
        echo "FAIL $name: exit $rc (want $want_rc); stdout: ${got:0:200}; stderr: $(head -c 200 /tmp/profile-test-err.$$)"
    fi
}

T="$(mktemp -d)"
# node's spelling of the path (C:/… in Git Bash on Windows, pwd -P elsewhere): it goes into the registries.
T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
# A path as profile prints it: with backslashes on Windows (cygpath exists there), unchanged elsewhere.
printed() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }
# The same inside a JSON string: each backslash doubled (a no-op where there are none).
json_printed() { printed "$1" | sed 's/\\/\\\\/g'; }
trap 'rm -rf "$T" /tmp/profile-test-err.$$' EXIT
