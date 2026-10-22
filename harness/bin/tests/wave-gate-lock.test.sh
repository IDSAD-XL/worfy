#!/usr/bin/env bash
# Tests of harness/bin/wave-gate: the e2e lock of a wave-gate that got a signal it cannot forward, or was killed
# without its signal handlers. The lock is released, or taken over at once by the next run when its holder (and
# the holder's gate) no longer runs; two waiting runs and a takeover token; a holder.json of another host or with
# no host. The world of wave-gate.test.sh (wave-gate-world.sh): temporary git repositories, a stub gate and gh. No
# network, no real gate, no real gh, no real /tmp/worfy-e2e.lock.
# Run: bash harness/bin/tests/wave-gate-lock.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/wave-gate-world.sh"

# --- the e2e lock of a wave-gate stopped by a signal or killed ------------------------------------
# a signal that cannot be forwarded to the gate as such (on Windows libuv sends no SIGHUP or SIGBREAK, and kill
# throws): the gate is ended all the same, the lock released, and the exit code is the signal's. The signal is
# emitted inside wave-gate once its gate runs, by a preload: Git Bash cannot send one to a native process. On every
# system; SIGBREAK only on Windows, where wave-gate listens for it.
EMIT="$T/emit-signal.cjs"
cat >"$EMIT" <<'EOF'
const fs = require("fs")
const t = setInterval(() => {
    if (!fs.existsSync(process.env.EMIT_WHEN)) return
    clearInterval(t)
    process.emit(process.env.EMIT_SIGNAL, process.env.EMIT_SIGNAL)
}, 50)
EOF
sigs="SIGHUP:129"; on_windows && sigs="$sigs SIGBREAK:149"
for pair in $sigs; do
    sig="${pair%%:*}"; code="${pair#*:}"
    new_world "emit-$sig" 1:a.txt
    S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
    touch "$GATE_DIR/hold"
    EMIT_SIGNAL="$sig" EMIT_WHEN="$(tn "$GATE_DIR/count")" node -r "$(tn "$EMIT")" "$WG" check "$S" >"$W/out" 2>&1 & wg=$!
    finish "$wg" 60
    rm -f "$GATE_DIR/hold"
    [ "$rc" = "$code" ] && [ ! -e "$L" ] && grep -q "stopped by $sig" "$W/out" \
        && ok "e2e lock: released when wave-gate gets $sig during its gate (exit $code)" || bad "e2e lock on $sig: exit $rc, lock $( [ -e "$L" ] && echo left || echo gone): $(tail -3 "$W/out")"
    unset GATE_LOCK
done
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
# killed while its gate still runs (SIGKILL leaves the gate and its e2e running): holder.json names the gate as
# `child`, and the lock is waited for until the gate has ended too. On Windows the gate ends with wave-gate (libuv
# puts node's children in a job object that is closed with node), so the next run takes the lock at once there.
new_world orphan 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
echo KILL >"$GATE_DIR/kill1"; touch "$GATE_DIR/hold"
STAND_IN_PARENTS="$GATE_DIR/parents" "$WG" check "$S" >"$W/out" 2>&1; rc=$?
rm -f "$GATE_DIR/kill1"
[ "$rc" -ne 0 ] && [ "$(q "$L/holder.json" 'Number.isInteger(s.child)' 2>&1)" = true ] \
    && ok "e2e lock: the holder.json of a killed run names its gate as child" || bad "e2e lock orphan: exit $rc, holder [$(cat "$L/holder.json" 2>&1)]"
"$WG" check "$S" >"$W/out2" 2>&1 & wg=$!
if on_windows; then
    # `hold` stays: a gate that outlived wave-gate would keep the lock until it is removed
    until_ok 30 held_twice && [ -f "$GATE_DIR/hold" ] \
        && ok "e2e lock: on Windows the killed run's gate ended with it, and its lock is taken" || bad "e2e lock orphan on Windows: not taken while hold was there [$(tail -2 "$W/out2")]"
    rm -f "$GATE_DIR/hold"
else
    until_ok 30 grep -q "waiting for the e2e lock" "$W/out2"; sleep 2
    [ "$(gate_count)" = 1 ] && [ -d "$L" ] && ok "e2e lock: the lock of a killed run is kept while its gate runs" || bad "e2e lock orphan: taken while the gate ran [$(tail -2 "$W/out2")]"
    rm -f "$GATE_DIR/hold"
fi
if until_ok 30 held_twice; then finish "$wg" 120; else finish "$wg" 0; rc="still waiting 30 s after the gate ended ($rc)"; fi
[ "$rc" = 0 ] && grep -q "which is not running" "$W/out2" && [ ! -e "$L" ] \
    && ok "e2e lock: taken at once when the killed run's gate has ended" || bad "e2e lock orphan after the gate: $rc: $(tail -3 "$W/out2")"
rm -rf "$L"; unset GATE_LOCK
# two runs wait on the lock of a dead wave-gate: one takes it over, the other waits for that one's lock, both run
# their gate, and no takeover token is left
gone2="$(node -e 'process.stdout.write(String(process.pid))')"
me="$(node -e 'process.stdout.write(require("os").hostname())')"
L2="$T/shared-e2e.lock"; mkdir "$L2"
printf '{"prs":[9],"what":"gate-full","pid":%s,"host":"%s","since":"x"}\n' "$gone2" "$me" >"$L2/holder.json"
new_world twin1 1:a.txt; W1="$W"; state "$W1/state.json" "$L2" 1
new_world twin2 1:a.txt; W2="$W"; state "$W2/state.json" "$L2" 1
# exec: the background job is wave-gate itself, so a kill after the time limit ends it
twin() { GATE_DIR="$1/gate" GATE_LOCK="$L2" GH_ORIGIN="$1/origin.git" GH_LOG="$1/gh/log" GH_TMP="$1/gh" SCREEN_DIR="$1/screen" exec "$WG" check "$1/state.json" >"$1/out" 2>&1; }
twin "$W1" & t1=$!; twin "$W2" & t2=$!
twins_done() { ! kill -0 "$t1" 2>/dev/null && ! kill -0 "$t2" 2>/dev/null; }
if until_ok 60 twins_done; then finish "$t1" 0; r1=$rc; finish "$t2" 0; r2=$rc
else finish "$t1" 0; r1="still waiting after 60 s ($rc)"; finish "$t2" 0; r2="still waiting after 60 s ($rc)"; fi
n="$(cat "$W1/out" "$W2/out" | grep -c "which is not running")"
[ "$r1" = 0 ] && [ "$r2" = 0 ] && [ "$n" = 1 ] && [ ! -e "$L2" ] && [ -z "$(ls -d "$L2".* 2>/dev/null)" ] \
    && ok "e2e lock: of two runs waiting on a dead lock one takes it over, both run" || bad "e2e lock twins: exit $r1 $r2, takeovers $n, left [$(ls -d "$L2"* 2>/dev/null)], dead pid $gone2: $(grep -h "not running\|waiting\|taken over" "$W1/out" "$W2/out" | tr '\n' '|')"
# a takeover token: a young one is another waiter taking the dead lock over right now, so the lock is waited for; an
# old one was left by a waiter killed in those milliseconds and is removed, and the dead lock is taken. The lock is
# older than its stale age: a dead lock under a token is not removed by age either, the token's holder removes it.
new_world token 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
mkdir "$L" "$L.takeover"
printf '{"prs":[9],"what":"gate-full","pid":%s,"host":"%s","since":"x"}\n' "$gone2" "$me" >"$L/holder.json"
touch -t 202001010000 "$L"   # after holder.json: creating a file in the folder gives it the current mtime again
"$WG" check "$S" >"$W/out" 2>&1 & wg=$!
until_ok 30 grep -q "waiting for the e2e lock" "$W/out"; sleep 2
[ "$(gate_count)" = 0 ] && [ -f "$L/holder.json" ] && [ -d "$L.takeover" ] \
    && ok "e2e lock: a dead lock under a young takeover token is waited for" || bad "e2e lock young token: [$(tail -2 "$W/out")]"
touch -t 202001010000 "$L.takeover"
if until_ok 30 grep -q "which is not running" "$W/out"; then finish "$wg" 120; else finish "$wg" 0; rc="not taken 30 s after the token aged ($rc)"; fi
[ "$rc" = 0 ] && [ ! -e "$L" ] && [ ! -e "$L.takeover" ] && [ "$(gate_count)" = 1 ] \
    && ok "e2e lock: an old takeover token is removed and the dead lock taken" || bad "e2e lock old token: $rc, left [$(ls -d "$L"* 2>/dev/null)]: $(tail -3 "$W/out")"
rm -rf "$L" "$L.takeover"; unset GATE_LOCK
# a holder.json without this host is not judged by its pid: the one-PR block of skills/epic-wave writes no host, and
# in Git Bash its pid is not a Windows pid; a pid of another host means nothing here. The young lock is waited for.
gone="$(node -e 'process.stdout.write(String(process.pid))')"
for host in none elsewhere; do
    new_world "holder-$host" 1:a.txt
    S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
    rec='{"prs":[9],"what":"gate-full","pid":'"$gone"',"since":"x"}'
    [ "$host" = none ] || rec='{"prs":[9],"what":"gate-full","pid":'"$gone"',"host":"'"$host"'","since":"x"}'
    mkdir "$L"; printf '%s\n' "$rec" >"$L/holder.json"
    "$WG" check "$S" >"$W/out" 2>&1 & wg=$!
    until_ok 30 grep -q "waiting for the e2e lock" "$W/out"; sleep 2
    [ "$(gate_count)" = 0 ] && grep -q "waiting for the e2e lock" "$W/out" && [ -f "$L/holder.json" ] \
        && ok "e2e lock: a young lock whose holder.json has host $host is waited for, its pid not looked at" || bad "e2e lock host $host: taken [$(tail -2 "$W/out")]"
    rm -f "$L/holder.json"; rmdir "$L"; finish "$wg" 120 || bad "e2e lock host $host: the run did not end: $rc"
    unset GATE_LOCK
done

caf_gone "$T"/*/screen/caf*.log && ok "no stub caffeinate of any test is left" || bad "stub caffeinate left: $(cat "$T"/*/screen/caf*.log)"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
