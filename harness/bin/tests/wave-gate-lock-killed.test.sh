#!/usr/bin/env bash
# Tests of harness/bin/wave-gate: the e2e lock of a wave-gate killed without its signal handlers. The lock stays with
# its holder.json, and the next run takes it at once because the holder's pid is not running. Apart from the other
# cases of the e2e lock (wave-gate-lock.test.sh): it needs the real pid of the killed run to stay free, which a loaded
# Windows machine does not promise. The world of wave-gate.test.sh (wave-gate-world.sh): temporary git repositories,
# a stub gate and gh. No network, no real gate, no real gh, no real /tmp/worfy-e2e.lock.
# Run: bash harness/bin/tests/wave-gate-lock-killed.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/wave-gate-world.sh"

# killed without its signal handlers (SIGKILL; on Windows every kill from another process): the lock stays with its
# holder.json, and the next run takes it at once because the holder's pid is not running, not after 30 min.
# On every system.
new_world killed 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
echo KILL >"$GATE_DIR/kill1"
# STAND_IN_PARENTS: on Windows the gate stub finds wave-gate's pid there, as in the resume case
STAND_IN_PARENTS="$GATE_DIR/parents" "$WG" check "$S" >"$W/out" 2>&1; rc=$?
rm -f "$GATE_DIR/kill1"
kp="$(q "$L/holder.json" s.pid 2>&1)"
[ "$rc" -ne 0 ] && [ -d "$L" ] && [ "$(q "$L/holder.json" 's.host===require("os").hostname()' 2>&1)" = true ] \
    && ok "e2e lock: a killed wave-gate leaves its lock with its pid and host (exit $rc)" || bad "e2e lock killed: exit $rc, holder [$(cat "$L/holder.json" 2>&1)]"
held_twice() { [ "$(grep -c 'lock=held' "$GATE_DIR/log" 2>/dev/null)" -ge 2 ]; }
"$WG" check "$S" >"$W/out" 2>&1 & wg=$!
if until_ok 30 held_twice; then finish "$wg" 120; else finish "$wg" 0; rc="still waiting after 30 s ($rc)"; fi
[ "$rc" = 0 ] && grep -q "held by pid $kp, which is not running" "$W/out" && [ ! -e "$L" ] \
    && ok "e2e lock: the lock of a killed wave-gate is taken at once by the next run" || bad "e2e lock of a killed run: $rc: $(tail -3 "$W/out")"
rm -rf "$L"; unset GATE_LOCK

caf_gone "$T"/*/screen/caf*.log && ok "no stub caffeinate of any test is left" || bad "stub caffeinate left: $(cat "$T"/*/screen/caf*.log)"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
