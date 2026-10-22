#!/usr/bin/env bash
# Tests of harness/bin/wave-gate: the screen and keep-awake around gate full — a screen locked before a run and
# during it (stub ioreg), caffeinate held while the commands live, and no screen check without ioreg and caffeinate.
# The world of wave-gate.test.sh (wave-gate-world.sh): temporary git repositories, a stub gate, gh, ioreg and
# caffeinate. No network, no real gate, no real gh, no real screen state, no real /tmp/worfy-e2e.lock.
# Run: bash harness/bin/tests/wave-gate-screen.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/wave-gate-world.sh"

# --- the screen: a locked screen before a gate run -------------------------------------------
if $RUN_SCREEN; then
    new_world screenpre 1:a.txt
    S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1
    : >"$SCREEN_DIR/locked"
    "$WG" check "$S" >"$W/out" 2>&1 & wg=$!
    # the wait polls ioreg every second: three calls in all, however late each one starts (a fixed 2 s here fit
    # only two calls of a slow ioreg)
    until_ok 30 grep -q "screen locked: gate full waits" "$W/out"
    until_ok 30 eval '[ "$(wc -l <"$SCREEN_DIR/ioreg.log" | tr -d " ")" -ge 3 ]'
    [ "$(gate_count)" = 0 ] && kill -0 "$wg" 2>/dev/null && [ "$(grep -c 'screen locked' "$W/out")" = 1 ] \
        && ok "locked screen: one line 'screen locked: gate full waits', the gate does not run" || bad "locked screen: $(gate_count) runs: $(cat "$W/out")"
    [ ! -e "$L" ] && ok "locked screen: the e2e lock is not held while it waits" || bad "locked screen: the e2e lock is held while waiting"
    grep -q "^-n Root -d1$" "$SCREEN_DIR/ioreg.log" && [ "$(wc -l <"$SCREEN_DIR/ioreg.log" | tr -d ' ')" -ge 3 ] \
        && ok "locked screen: ioreg -n Root -d1, polled while it waits" || bad "locked screen: ioreg calls: $(cat "$SCREEN_DIR/ioreg.log" 2>/dev/null)"
    rm -f "$SCREEN_DIR/locked"
    finish "$wg" 120
    [ "$rc" -eq 0 ] && [ "$(gate_count)" = 1 ] && [ "$(q "$S" s.status)" = green ] && ok "locked screen: unlocked -> the gate runs, green" || bad "locked screen: after unlock exit $rc runs $(gate_count)"
    # the screen locks while the check waits for the e2e lock: the lock is given back and the check waits
    new_world screenlock 1:a.txt
    S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1
    mkdir "$L"
    "$WG" check "$S" >"$W/out" 2>&1 & wg=$!
    until_ok 30 grep -q "waiting for the e2e lock" "$W/out"
    : >"$SCREEN_DIR/locked"; rmdir "$L"
    until_ok 30 grep -q "screen locked: gate full waits" "$W/out"; sleep 1
    [ "$(gate_count)" = 0 ] && [ ! -e "$L" ] && ok "locked screen after the e2e lock: the lock is released, the gate waits" || bad "locked screen after the lock: $(gate_count) runs, lock $( [ -e "$L" ] && echo held || echo free): $(cat "$W/out")"
    rm -f "$SCREEN_DIR/locked"
    finish "$wg" 120
    [ "$rc" -eq 0 ] && [ "$(gate_count)" = 1 ] && ok "locked screen after the e2e lock: unlocked -> green" || bad "locked screen after the lock: exit $rc runs $(gate_count)"
    # an unlocked screen: ioreg is asked, the gate runs at once
    new_world screenno 1:a.txt
    S="$W/state.json"; state "$S" null 1
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 0 ] && [ "$(gate_count)" = 1 ] && grep -q "^-n Root -d1$" "$SCREEN_DIR/ioreg.log" && ! grep -q "screen locked" "$W/out" \
        && ok "unlocked screen: IOConsoleLocked = No -> the gate runs" || bad "unlocked screen: exit $rc runs $(gate_count): $(cat "$W/out")"
fi

# --- the screen locks during gate full ------------------------------------------------------------
if $RUN_SCREEN; then
    # the e2e did not get its window and the screen was locked: not red — not verified, repeated after unlock
    new_world screenmid 1:a.txt 2:b.txt
    S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1 2
    : >"$GATE_DIR/lockscreen"; touch "$GATE_DIR/window"
    "$WG" check "$S" >"$W/out" 2>&1 & wg=$!
    until_ok 30 grep -q "screen locked: gate full waits" "$W/out"; sleep 1
    [ "$(gate_count)" = 1 ] && [ "$(q "$S" 's.runs.length')" = 1 ] && [ "$(q "$S" 's.runs[0].outcome')" = unverified ] \
        && [[ "$(q "$S" 's.runs[0].reason')" == "screen locked"* ]] && [ "$(q "$S" s.status)" = checking ] \
        && ok "screen locked during the run: the run is recorded not verified (screen locked), not red" || bad "screen locked during the run: runs $(q "$S" s.runs 2>&1) status $(q "$S" s.status 2>&1)"
    grep -q "screen locked during gate full" "$W/out" && [ ! -e "$L" ] && ! grep -q "window was not shown" "$(q "$S" 's.runs[0].log')" && ok "screen locked during the run: said so, the e2e lock released while it waits" || bad "screen locked during the run: output $(cat "$W/out")"
    rm -f "$SCREEN_DIR/locked"
    finish "$wg" 120
    [ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && [ "$(gate_count)" = 2 ] && [ "$(q "$S" 's.runs.map(r=>r.role+":"+r.size+":"+r.outcome).join(" ")')" = "full:2:unverified full:2:green" ] \
        && [ "$(q "$S" '"flaky" in s')" = false ] && ok "screen locked during the run: repeated after unlock, green, not flaky" || bad "screen locked during the run: exit $rc runs $(q "$S" 's.runs.map(r=>r.role+":"+r.size+":"+r.outcome)') flaky $(q "$S" s.flaky 2>&1)"
    # the screen was locked in the middle of the run and unlocked before its end: seen by the poll during the run
    new_world screenblip 1:a.txt 2:b.txt
    S="$W/state.json"; state "$S" null 1 2
    echo 30 >"$GATE_DIR/lockfor"; touch "$GATE_DIR/window"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 0 ] && [ "$(q "$S" 's.runs.map(r=>r.role+":"+r.size+":"+r.outcome).join(" ")')" = "full:2:unverified full:2:green" ] && ! grep -q "gate full waits" "$W/out" \
        && ok "screen locked and unlocked during the run: not verified, run again at once, green" || bad "screen locked and unlocked during the run: exit $rc runs $(q "$S" 's.runs.map(r=>r.role+":"+r.size+":"+r.outcome)'): $(cat "$W/out")"
    # test:package (the packaged .app) also needs a window
    new_world screenpkg 1:a.txt
    S="$W/state.json"; state "$S" null 1
    echo 30 >"$GATE_DIR/lockfor"; echo test:package >"$GATE_DIR/window"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 0 ] && [ "$(q "$S" 's.runs.map(r=>r.role+":"+r.outcome).join(" ")')" = "full:unverified full:green" ] \
        && ok "screen locked, test:package failed: not verified, run again" || bad "screen locked, test:package: exit $rc runs $(q "$S" 's.runs.map(r=>r.role+":"+r.outcome)')"
fi
# the same failure with the screen unlocked is red (the e2e load case): the usual repeat
new_world windowred 1:a.txt
S="$W/state.json"; state "$S" null 1; touch "$GATE_DIR/window"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.runs.map(r=>r.role+":"+r.outcome).join(" ")')" = "full:red retry:green" ] && [[ "$(q "$S" s.flaky)" == *"spec1.spec.ts"* ]] \
    && ok "e2e failed, screen unlocked: red, repeated as flaky" || bad "e2e failed, screen unlocked: exit $rc runs $(q "$S" 's.runs.map(r=>r.role+":"+r.outcome)')"
if $RUN_SCREEN; then
    # only `test` failed (no e2e script), with the screen locked: red
    new_world screenred 1:a.txt
    S="$W/state.json"; state "$S" null 1; : >"$GATE_DIR/lockscreen"; touch "$GATE_DIR/unitonce"
    "$WG" check "$S" >"$W/out" 2>&1 & wg=$!
    until_ok 30 grep -q "screen locked: gate full waits" "$W/out"
    [ "$(q "$S" 's.runs.map(r=>r.role+":"+r.outcome).join(" ")')" = "full:red" ] && ok "screen locked, only test failed: red" || bad "screen locked, only test failed: runs $(q "$S" 's.runs.map(r=>r.role+":"+r.outcome)' 2>&1)"
    rm -f "$SCREEN_DIR/locked"; finish "$wg" 120 || bad "screen: the run did not end: $rc"
    # the screen locks during every run: three tries, then not verified (exit 3); the next check runs it again
    new_world screenloop 1:a.txt
    S="$W/state.json"; state "$S" null 1
    echo 1 >"$GATE_DIR/lockscreen"; touch "$GATE_DIR/window" "$GATE_DIR/keep"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 3 ] && [ "$(q "$S" s.status)" = unverified ] && [ "$(gate_count)" = 3 ] && [ "$(q "$S" 's.runs.filter(r=>r.outcome==="unverified").length')" = 3 ] \
        && ok "screen locked during every run: 3 tries, then unverified, exit 3" || bad "screen locked every run: exit $rc status $(q "$S" s.status) runs $(gate_count)"
    rm -f "$GATE_DIR/lockscreen" "$GATE_DIR/window" "$GATE_DIR/keep" "$SCREEN_DIR/locked"
    "$WG" check "$S" >/dev/null 2>&1; rc=$?
    [ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && [ "$(gate_count)" = 4 ] && ok "screen locked every run: the next check runs it again, green" || bad "screen locked every run: next check exit $rc runs $(gate_count)"
fi

# --- caffeinate: the commands keep the display awake while they live -----------------------
if $RUN_SCREEN; then
    new_world caf 1:a.txt
    S="$W/state.json"; state "$S" null 1
    "$WG" check "$S" >"$W/out" 2>&1 & wg=$!; finish "$wg" 120
    [ "$rc" -eq 0 ] && [ "$(awk '{$1=""; print substr($0,2)}' "$SCREEN_DIR/caf.log")" = "-d -w $wg" ] \
        && ok "caffeinate: check runs caffeinate -d -w <its own pid>" || bad "caffeinate: check exit $rc, pid $wg, calls: $(cat "$SCREEN_DIR/caf.log" 2>/dev/null)"
    caf_gone "$SCREEN_DIR/caf.log" && ok "caffeinate: gone after check exits" || bad "caffeinate: left after check"
    mv "$SCREEN_DIR/caf.log" "$SCREEN_DIR/caf-check.log"
    "$WG" merge "$S" >"$W/mout" 2>&1 & wg=$!; finish "$wg" 120
    [ "$rc" -eq 0 ] && [ "$(awk '{$1=""; print substr($0,2)}' "$SCREEN_DIR/caf.log")" = "-d -w $wg" ] \
        && ok "caffeinate: merge runs caffeinate -d -w <its own pid>" || bad "caffeinate: merge exit $rc, pid $wg, calls: $(cat "$SCREEN_DIR/caf.log" 2>/dev/null)"
    caf_gone "$SCREEN_DIR/caf.log" && ok "caffeinate: gone after merge exits" || bad "caffeinate: left after merge"
fi

# --- no ioreg and no caffeinate in PATH: no screen check, no keep-awake -----------------------------
# A PATH of links to the tools the script and the stubs need, without /usr/bin and /usr/sbin, where macOS keeps both.
# Git Bash on Windows has neither command anywhere: there the PATH is the test's own without the screen stubs. Its
# ln -s copies a program instead of linking it, and a copied git.exe or bash.exe cannot load the DLLs of its folder.
if on_windows; then
    NOPOWER_PATH="${PATH//"$POWER:"/}"
else
    MINBIN="$T/minbin"; mkdir -p "$MINBIN"
    for c in node git bash sh env cat ls tr rm cp touch mkdir sleep mktemp awk; do p="$(command -v "$c")" && ln -s "$p" "$MINBIN/$c"; done
    NOPOWER_PATH="$STUBS:$MINBIN"
fi
new_world nopower 1:a.txt
S="$W/state.json"; state "$S" null 1
: >"$SCREEN_DIR/locked"
if env PATH="$NOPOWER_PATH" bash -c 'command -v ioreg || command -v caffeinate' >/dev/null 2>&1; then
    bad "no ioreg: the minimal PATH still has ioreg or caffeinate"
else
    PATH="$NOPOWER_PATH" "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    PATH="$NOPOWER_PATH" "$WG" merge "$S" >"$W/mout" 2>&1; mrc=$?
    [ "$rc" -eq 0 ] && [ "$(gate_count)" = 1 ] && ! grep -q "screen locked" "$W/out" && [ ! -e "$SCREEN_DIR/ioreg.log" ] \
        && ok "no ioreg in PATH: no screen check, the gate runs" || bad "no ioreg: exit $rc runs $(gate_count): $(cat "$W/out")"
    [ "$mrc" -eq 0 ] && [ ! -e "$SCREEN_DIR/caf.log" ] && ok "no caffeinate in PATH: check and merge run without it" || bad "no caffeinate: merge exit $mrc: $(cat "$W/mout")"
fi

caf_gone "$T"/*/screen/caf*.log && ok "no stub caffeinate of any test is left" || bad "stub caffeinate left: $(cat "$T"/*/screen/caf*.log)"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
