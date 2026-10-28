#!/usr/bin/env bash
# Tests of harness/bin/wave-gate: the e2e lock. A live lock of another holder is waited for, holder.json names the
# set, a stale lock is taken over and a young one is not, the heartbeat moves its mtime, and a SIGTERM releases it.
# Then the e2e lock of a wave-gate that got a signal it cannot forward, or was killed without its signal handlers. The lock is released, or taken over at once by the next run when its holder (and
# the holder's gate) no longer runs; two waiting runs and a takeover token; a holder.json of another host or with
# no host. The world of wave-gate.test.sh (wave-gate-world.sh): temporary git repositories, a stub gate and gh. No
# network, no real gate, no real gh, no real /tmp/worfy-e2e.lock.
# Run: bash harness/bin/tests/wave-gate-lock.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/wave-gate-world.sh"

# --- the e2e lock ---------------------------------------------------------------------------
new_world lock 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1
export GATE_LOCK="$L"
mkdir "$L"
( while [ -d "$L" ]; do touch -c "$L"; sleep 1; done ) & toucher=$!
"$WG" check "$S" >"$W/out" 2>&1 & wg=$!
# 3 s from the moment it says it waits, not from its start: a late start left no time to wait in
until_ok 30 grep -q "waiting for the e2e lock" "$W/out"; sleep 3
[ "$(gate_count)" = 0 ] && kill -0 "$wg" 2>/dev/null && ok "e2e lock: a live lock held by another -> waits" || bad "e2e lock: did not wait ($(gate_count) runs)"
rmdir "$L"; wait "$toucher" 2>/dev/null
finish "$wg" 120
[ "$rc" -eq 0 ] && [ "$(gate_count)" = 1 ] && grep -q "lock=held" "$GATE_DIR/log" && ok "e2e lock: taken after release, the gate runs under it" || bad "e2e lock: exit $rc runs $(gate_count) $(cat "$GATE_DIR/log")"
[ ! -e "$L" ] && ok "e2e lock: released after the run" || bad "e2e lock: left after the run"
# the holder of the lock: holder.json with the numbers of the set while the gate runs, gone with the lock
new_world holder 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1 2 3; export GATE_LOCK="$L"
STAND_IN_PARENTS="$GATE_DIR/parents" "$WG" check "$S" >"$W/out" 2>&1 & wg=$!; finish "$wg" 120
# wave-gate's pid as node sees it: in Git Bash its Windows pid, which the gate stand-in recorded as its parent
on_windows && wg="$(head -n 1 "$GATE_DIR/parents" 2>/dev/null)"
h="$GATE_DIR/holder.1.json"
[ "$rc" -eq 0 ] && [ -f "$h" ] && [ "$(q "$h" 's.prs.join(",")+" "+s.what+" "+s.pid')" = "1,2,3 gate-full $wg" ] \
    && ok "e2e lock: holder.json names the set (prs 1,2,3), gate-full and the pid of wave-gate while the gate runs" || bad "e2e lock holder: exit $rc, holder $(cat "$h" 2>/dev/null)"
[ "$(q "$h" '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s.since)')" = true ] && ok "e2e lock: holder.json has since (ISO 8601 UTC)" || bad "e2e lock holder: since $(q "$h" s.since 2>&1)"
[ ! -e "$L" ] && ok "e2e lock: holder.json goes with the lock when it is released" || bad "e2e lock holder: left $(ls -A "$L" 2>/dev/null)"
# a red set: each run of the bisection names the PRs it checks
new_world holderbis 1:a.txt 2:RED 3:c.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1 2 3; export GATE_LOCK="$L"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
got="$(for f in "$GATE_DIR"/holder.*.json; do q "$f" 's.prs.join(",")'; echo; done | sort -u | tr '\n' ' ')"
[ "$rc" -eq 2 ] && [[ " $got" == *" 1,2,3 "* ]] && [[ " $got" == *" 1 "* || " $got" == *" 1,2 "* ]] && [ ! -e "$L" ] \
    && ok "e2e lock: each run of the bisection names its own prefix in holder.json ($got)" || bad "e2e lock holder bisection: exit $rc [$got]"
# stale: older than 30 minutes (the default) — removed with the holder.json of whoever left it, and taken
new_world stale 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
mkdir "$L"; printf '{"prs":[9],"what":"gate-full","pid":1,"since":"2020-01-01T00:00:00Z"}\n' >"$L/holder.json"; touch -t 202001010000 "$L"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && grep -q "lock=held" "$GATE_DIR/log" && [ ! -e "$L" ] && ok "e2e lock: a lock older than 30 min is taken over and released" || bad "e2e lock stale: exit $rc $(tail -3 "$W/out")"
[ "$(q "$GATE_DIR/holder.1.json" 's.prs.join(",")' 2>&1)" = 1 ] && ok "e2e lock: the abandoned holder.json is replaced by ours" || bad "e2e lock stale holder: $(cat "$GATE_DIR/holder.1.json" 2>/dev/null)"
# ours was removed as abandoned during the run and another agent holds the lock now: on release its holder.json
# and its lock stay
new_world foreign 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
printf '%s\n' "rm -f '$L/holder.json'; rmdir '$L'; mkdir '$L'; echo '{\"prs\":[7],\"what\":\"gate-full\",\"pid\":1,\"since\":\"x\"}' >'$L/holder.json'" >"$GATE_DIR/takeover"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$L/holder.json" 's.prs.join(",")' 2>&1)" = 7 ] && ok "e2e lock: on release, a lock someone else holds now keeps its holder.json and stays" || bad "e2e lock foreign: exit $rc, lock [$(ls -A "$L" 2>&1)]"
rm -f "$L/holder.json"; rmdir "$L" 2>/dev/null; rm -f "$GATE_DIR/takeover"
# Sets the mtime of $2 to $1 seconds before $3 (default: now). The time goes to touch -t in UTC, which has no summer
# time: in local time the hour that the end of summer time repeats is ambiguous, touch takes its first pass, and a
# lock set to 25 min old came out 85 min old and was taken over as stale (2026-10-25, EEST -> EET).
aged() {
    local t=$(( ${3:-$(date +%s)} - $1 ))
    TZ=UTC0 touch -t "$(TZ=UTC0 date -r "$t" +%Y%m%d%H%M.%S 2>/dev/null || TZ=UTC0 date -d "@$t" +%Y%m%d%H%M.%S)" "$2"
}
# A TZ whose summer time (UTC+3) ends exactly at the instant $1, so that the local time of $1 is the start of the
# hour that the end repeats, on its second pass. On 2026-10-25 (EEST -> EET) the local time zone of the Mac did that
# by itself between 01:25 and 02:25 UTC. Read back as local time, that time has two instants, $1 and an hour
# earlier, and every instant between them is still summer time: the binary search of macOS mktime meets only summer
# time there and lands on the earlier one, unless one of its steps hits $1 itself (one epoch second in 4096, see
# dst_pick). A summer time that ended before $1 (it used to end 5 min before) left part of that hour in winter time,
# and the search landed there and took $1 itself for about 7 % of the epoch values.
# shortcut: on 1 January before about 01:00 UTC the rule's end comes before its start and summer time inverts, redo if this case runs then.
ambiguous_tz() {
    local at
    at="$(TZ=UTC0 date -r $(($1 + 10800)) '+%j %H:%M:%S' 2>/dev/null || TZ=UTC0 date -d "@$(($1 + 10800))" '+%j %H:%M:%S')"
    echo "XST-2XDT-3,0/0,$(( 10#${at%% *} - 1 ))/${at#* }"
}
# How many minutes before $1 (an epoch second) touch -t puts a file given the local time, in the TZ $2, of 25 min
# before $1.
dst_probe() {
    local p; p="$(mktemp)"
    ( export TZ="$2"; t=$(( $1 - 1500 )); touch -t "$(date -r "$t" +%Y%m%d%H%M.%S 2>/dev/null || date -d "@$t" +%Y%m%d%H%M.%S)" "$p" )
    echo $(( ( $1 - $(node -e "process.stdout.write(String(Math.floor(require(\"fs\").statSync(process.argv[1]).mtimeMs / 1000)))" "$p") ) / 60 ))
    rm -f "$p"
}
# Sets dst_now, dst_tz and probe_min for the summer-time case counting from the epoch second $1; returns 1 if the
# probe shows no 85-min lock. The binary search of macOS mktime hits the lock's own instant for single isolated epoch
# seconds, 4096 s apart, so a miss is tried once more a second earlier.
dst_pick() {
    local try
    for try in 0 1; do
        dst_now=$(( $1 - try )); dst_tz="$(ambiguous_tz $((dst_now - 1500)))"; probe_min="$(dst_probe "$dst_now" "$dst_tz")"
        [ "$probe_min" -ge 80 ] && [ "$probe_min" -le 90 ] && return 0
    done
    return 1
}
# The young-lock case in the time zone $1 (empty: the one of the machine); $3 is the epoch second the lock's age
# counts from (default: now).
young_lock() {
    new_world "young$2" 1:a.txt
    S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
    mkdir "$L"; ( [ -z "$1" ] || export TZ="$1"; aged 1500 "$L" "${3:-}" )
    "$WG" check "$S" >"$W/out" 2>&1 & wg=$!
    until_ok 30 grep -q "waiting for the e2e lock" "$W/out"; sleep 2
    [ "$(gate_count)" = 0 ] && grep -q "waiting for the e2e lock" "$W/out" && ok "e2e lock: a lock 25 min old is not taken over${1:+ (TZ=$1)}" || bad "e2e lock: a 25-min lock was taken${1:+ (TZ=$1)}"
    rmdir "$L"; finish "$wg" 120 || bad "young lock: the run did not end: $rc"
}
young_lock "" ""
# The case is worth running in that TZ only where its local time is read wrong: there touch -t with the local time of
# 25 min ago sets an mtime 85 min ago. The probe and the lock count from one epoch second, so both read the same
# local time.
dst_pick "$(date +%s)"; dst_ok=$?
dst_miss="e2e lock: the 25-min lock in a TZ whose summer time ended at the lock's time: local time there gives a lock $probe_min min old, not 85 (TZ=$dst_tz)"
if [ "$dst_ok" = 0 ]; then young_lock "$dst_tz" -dst "$dst_now"
# On macOS the probe is known to show the 85 min, so a miss there is a broken TZ, not the platform: it fails
# instead of dropping the only case that sees aged() go back to local time. The skip guard above runs earlier.
elif [ "$(uname -s)" = Darwin ]; then bad "$dst_miss"
else skip "$dst_miss"; fi
# heartbeat: the lock's mtime moves during a run
new_world beat 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
touch "$GATE_DIR/lockwatch"
WAVE_GATE_HEARTBEAT_S=1 "$WG" check "$S" >"$W/out" 2>&1; rc=$?
s=$(awk '$1=="start"{print $2}' "$GATE_DIR/lockwatch"); e=$(awk '$1=="end"{print $2}' "$GATE_DIR/lockwatch")
[ "$rc" -eq 0 ] && [ -n "$s" ] && [ -n "$e" ] && [ "$e" != gone ] && [ "$e" -gt "$s" ] && ok "e2e lock: the heartbeat moves the mtime during the run ($s -> $e)" || bad "e2e lock heartbeat: exit $rc start $s end $e"
# an error (a signal) in the middle of a run: the lock is released
if $RUN_SIGTERM; then
    new_world sig 1:a.txt
    S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
    echo TERM >"$GATE_DIR/kill1"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 143 ] && [ ! -e "$L" ] && ok "e2e lock: released when wave-gate is stopped (exit 143)" || bad "e2e lock on signal: exit $rc, lock $( [ -e "$L" ] && echo left || echo gone)"
    [ -s "$SCREEN_DIR/caf.log" ] && caf_gone "$SCREEN_DIR/caf.log" && ok "signal: no caffeinate left after SIGTERM" || bad "signal: caffeinate left or not started: $(cat "$SCREEN_DIR/caf.log" 2>/dev/null)"
    unset GATE_LOCK
fi


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
# A pid no system hands out (above the pid limit of Linux, macOS and Windows), not one of a process that has just
# exited: a loaded Windows runner gave such a freed pid to a new process, the dead holder was taken for a live one,
# and its lock was removed by age instead (CI run 40562890010).
gone2=2147483644
me="$(node -e 'process.stdout.write(require("os").hostname())')"
L2="$T/shared-e2e.lock"; mkdir "$L2"
printf '{"prs":[9],"what":"gate-full","pid":%s,"host":"%s","since":"x"}\n' "$gone2" "$me" >"$L2/holder.json"
new_world twin1 1:a.txt; W1="$W"; state "$W1/state.json" "$L2" 1
new_world twin2 1:a.txt; W2="$W"; state "$W2/state.json" "$L2" 1
# exec: the background job is wave-gate itself, so a kill after the time limit ends it
twin() { GATE_DIR="$1/gate" GATE_LOCK="$L2" GH_ORIGIN="$1/origin.git" GH_LOG="$1/gh/log" GH_TMP="$1/gh" SCREEN_DIR="$1/screen" exec "$WG" check "$1/state.json" >"$1/out" 2>&1; }
twin "$W1" & t1=$!; twin "$W2" & t2=$!
twins_done() { ! kill -0 "$t1" 2>/dev/null && ! kill -0 "$t2" 2>/dev/null; }
# The two runs take turns on one lock, each with its gate: on a loaded Windows runner that took longer than a
# minute (CI run 40607908878). So the wait lasts while their output grows, and ends 60 s after its last change.
twins_out() { cat "$W1/out" "$W2/out" 2>/dev/null | wc -c; }
seen=-1; still=0
while ! twins_done && [ "$still" -lt 300 ]; do
    now="$(twins_out)"; if [ "$now" != "$seen" ]; then seen=$now; still=0; else still=$((still + 1)); fi
    sleep 0.2
done
if twins_done; then finish "$t1" 0; r1=$rc; finish "$t2" 0; r2=$rc
else finish "$t1" 0; r1="still waiting 60 s after the last output ($rc)"; finish "$t2" 0; r2="still waiting 60 s after the last output ($rc)"; fi
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
