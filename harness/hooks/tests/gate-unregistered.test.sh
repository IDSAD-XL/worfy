#!/usr/bin/env bash
# Tests of gate.sh and stop.sh for a repository outside the gate/config.json registry.
# Run: bash harness/hooks/tests/gate-unregistered.test.sh; exit code 0 means everything passed.
#
# The registry, the state directory and the repositories are temporary (CLAUDE_GATE_CONFIG, CLAUDE_GATE_STATE):
# the test does not touch the live markers in $HARNESS_HOME/gate/state.
set -u
# The hooks under test are the copies next to this test (harness/hooks).
HOOKS="${HOOKS_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"   # HOOKS_DIR runs the test on another copy of the hooks
GATE="$HOOKS/gate.sh"
STOP="$HOOKS/stop.sh"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
# The test sets the session itself through the hook JSON; the session it was started from does not count.
unset CLAUDE_CODE_SESSION_ID
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()   { pass=$((pass + 1)); echo "ok   $1"; }
bad()  { fail=$((fail + 1)); echo "FAIL $1"; }

export CLAUDE_GATE_STATE="$T/state" CLAUDE_GATE_CONFIG="$T/config.json"
mkdir -p "$T/state" "$T/unreg" "$T/reg"
git -C "$T/unreg" init -q && git -C "$T/unreg" commit -q --allow-empty -m init
git -C "$T/reg" init -q && git -C "$T/reg" commit -q --allow-empty -m init
printf '{"repos":[{"key":"t","match":"%s","pm":"npm","root":{},"workspace":{}}]}\n' "$T/reg" >"$CLAUDE_GATE_CONFIG"
tag() { printf '%s' "$1" | shasum | awk '{print $1}' | cut -c1-8; }

payload='{"session_id":"test-session"}'

# 1. gate.sh in an unregistered repository: the message line and code 3, a marker for stop.sh.
#    The line names the registry the gate read — here the temporary one from CLAUDE_GATE_CONFIG
#    (gate.sh shortens a path under $HOME to ~, so the expectation does the same).
out="$(cd "$T/unreg" && printf '%s' "$payload" | bash "$GATE" fast 2>&1)"; rc=$?
tilde='~'
line="[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: проект не зарегистрирован в ${CLAUDE_GATE_CONFIG/#$HOME/$tilde}"
if [ "$rc" -eq 3 ] && printf '%s\n' "$out" | grep -qxF "$line"; then ok "gate unregistered -> exit 3 + message"
else bad "gate unregistered: exit $rc, out: ${out:0:300}"; fi
[ -s "$T/state/nokey-unregistered-$(tag "$T/unreg")-test-session" ] && ok "gate unregistered -> marker written" || bad "gate unregistered: no marker"

# 2. stop.sh after code 3: does not hold the turn (code 0, not 2), but says "not verified" and removes the marker.
out="$(cd "$T/unreg" && printf '%s' "$payload" | bash "$STOP" 2>"$T/stop.err")"; rc=$?
if [ "$rc" -eq 0 ] && [[ "$out" == *additionalContext* ]] && [[ "$out" == *"not verified"* ]] && [[ "$out" != *'"decision"'* ]] && [ ! -s "$T/stop.err" ]; then
    ok "stop after gate exit 3 -> not blocking (exit 0), says 'not verified'"
else bad "stop after exit 3: exit $rc, out: ${out:0:300}, err: $(head -c 200 "$T/stop.err")"; fi
[ ! -e "$T/state/nokey-unregistered-$(tag "$T/unreg")-test-session" ] && ok "stop consumed the marker" || bad "stop left the marker"

# 3. A second Stop without a new gate run stays silent.
out="$(cd "$T/unreg" && printf '%s' "$payload" | bash "$STOP" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "stop again -> silent exit 0" || bad "stop again: exit $rc, out: ${out:0:200}"

# 4. A non-git directory is still code 0 with no output (outside the scope of Q56).
out="$(cd "$T/state" && bash "$GATE" fast </dev/null 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "gate outside git -> exit 0 (unchanged)" || bad "gate outside git: exit $rc, out: ${out:0:200}"

# 5. Regression: in a registered repository the red marker still holds the turn (code 2).
date -u +%Y-%m-%dT%H:%M:%SZ >"$T/state/red-t-$(tag "$T/reg")"
out="$(cd "$T/reg" && printf '%s' "$payload" | bash "$STOP" 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$out" == *"The quality gate is red"* ]] && ok "stop registered + red -> exit 2 (unchanged)" || bad "stop registered red: exit $rc, out: ${out:0:200}"

# 6. A "not registered" marker was written, then the repository was added to the registry: stop.sh
#    does not say the stale "not verified" and silently removes the marker.
mkdir -p "$T/later"
git -C "$T/later" init -q && git -C "$T/later" commit -q --allow-empty -m init
out="$(cd "$T/later" && printf '%s' "$payload" | bash "$GATE" fast 2>&1)"; rc=$?
lm="$T/state/nokey-unregistered-$(tag "$T/later")-test-session"
[ "$rc" -eq 3 ] && [ -s "$lm" ] && ok "later: gate while unregistered -> marker" || bad "later: gate exit $rc, marker missing"
printf '{"repos":[{"key":"t","match":"%s","pm":"npm","root":{},"workspace":{}},{"key":"later","match":"%s","pm":"npm","root":{},"workspace":{}}]}\n' "$T/reg" "$T/later" >"$CLAUDE_GATE_CONFIG"
out="$(cd "$T/later" && printf '%s' "$payload" | bash "$STOP" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "registered afterwards -> stop silent" || bad "registered afterwards: exit $rc, out: ${out:0:300}"
[ ! -e "$lm" ] && ok "registered afterwards -> stale marker dropped" || bad "registered afterwards: marker left"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
