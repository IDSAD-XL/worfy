#!/usr/bin/env bash
# Tests of harness/bin/wave-gate: a run broken off and resumed, the squash merges (base moved, tree mismatch, a merge
# resumed after a break, an error in the middle, a refused gh pr merge), one check per repository (the pid file), the
# build output between runs, and workflow.ci "batch" (no CI on the PR head, one CI run on main after the wave).
# The world of wave-gate.test.sh (wave-gate-world.sh): temporary git repositories, a stub gate and gh. No network,
# no real gate, no real gh, no real /tmp/worfy-e2e.lock.
# Run: bash harness/bin/tests/wave-gate-merge.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/wave-gate-world.sh"

# --- resume: a run broken off after the first gate full ----------------------------------
new_world resume 1:a.txt 2:b.txt 3:RED 4:d.txt 5:e.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1 2 3 4 5
echo KILL >"$GATE_DIR/kill2"   # the second run (the repeat) kills wave-gate: an abrupt end of the session
# STAND_IN_PARENTS: on Windows the gate stub finds wave-gate's pid there (no file is written elsewhere)
STAND_IN_PARENTS="$GATE_DIR/parents" "$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 137 ] && [ "$(q "$S" 's.runs.length')" = 1 ] && [ "$(q "$S" 's.runs[0].outcome')" = red ] && ok "resume: killed after the first run, which is recorded" || bad "resume: exit $rc runs $(q "$S" s.runs 2>&1)"
[ -d "$(TMPW_OF)" ] && ok "resume: the broken run left its worktree" || bad "resume: no worktree left"
before=$(gate_count)
# the killed run's lock keeps a holder.json with a dead pid, which only a takeover removes: without one this waits
WAVE_GATE_LOCK_STALE_S=2 "$WG" check "$S" >"$W/out2" 2>&1 & wg=$!
finish "$wg" 120
after=$(gate_count)
[ "$rc" = 2 ] && [ "$(q "$S" s.culprit)" = 3 ] && ok "resume: the second check finds PR 3" || bad "resume: exit $rc culprit $(q "$S" s.culprit 2>&1): $(tail -5 "$W/out2")"
# 4 runs in all (full, retry, 2 bisect); the first is not repeated: 2 + 3 = 5 stub calls with the killed one
[ "$before" = 2 ] && [ "$after" = 5 ] && [ "$(q "$S" 's.runs.length')" = 4 ] && ok "resume: the finished run is not repeated ($before + $((after - before)) stub calls)" || bad "resume: stub calls $before then $after, runs $(q "$S" 's.runs.length')"
grep -q "reus" "$W/out2" && ok "resume: the worktree of the broken run is reused" || bad "resume: no reuse in the output: $(head -5 "$W/out2")"
[ ! -e "$(TMPW_OF)" ] && [ ! -e "$L" ] && ok "resume: worktree and stale lock gone after the end" || bad "resume: worktree or lock left"
# the run killed with SIGKILL ran no exit handler: its caffeinate ends because of -w <its pid> alone
if $RUN_SCREEN; then
    [ "$(wc -l <"$SCREEN_DIR/caf.log" | tr -d ' ')" = 2 ] && caf_gone "$SCREEN_DIR/caf.log" \
        && ok "resume: no caffeinate left after a SIGKILL of wave-gate" || bad "resume: caffeinate left: $(cat "$SCREEN_DIR/caf.log" 2>/dev/null)"
fi
# origin/main moved: the state is reset, the set is checked again
new_world moved 1:a.txt 2:b.txt
S="$W/state.json"; state "$S" null 1 2
"$WG" check "$S" >/dev/null 2>&1
old_base="$(q "$S" s.base)"
echo more >"$W/seed/more.txt"; git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m more && git -C "$W/seed" push -q origin HEAD:main
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.base)" = "$(git -C "$W/origin.git" rev-parse main)" ] && [ "$(q "$S" s.base)" != "$old_base" ] && [ "$(gate_count)" = 2 ] \
    && ok "base moved: check again resets and checks on the new base" || bad "base moved: exit $rc base $(q "$S" s.base) runs $(gate_count)"
grep -q "more.txt" "$GATE_DIR/log" && ok "base moved: the new run has the new base in its tree" || bad "base moved: gate tree $(tail -1 "$GATE_DIR/log")"

# --- merge: base moved, tree mismatch ------------------------------------------------------
new_world mbase 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; state "$S" null 1 2 3
"$WG" check "$S" >/dev/null 2>&1
echo other >"$W/seed/other.txt"; git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m other && git -C "$W/seed" push -q origin HEAD:main
"$WG" merge "$S" >"$W/mout" 2>&1; rc=$?
[ "$rc" -eq 4 ] && [ ! -s "$GH_LOG" ] && ok "merge: origin/main != base -> no merge, exit 4" || bad "merge base moved: exit $rc gh $(cat "$GH_LOG" 2>/dev/null)"
[[ "$(q "$S" s.merge.stopped.reason)" == "base moved"* ]] && ok "merge: the reason is base moved" || bad "merge base moved: reason $(q "$S" s.merge 2>&1)"
new_world mtree 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; state "$S" null 1 2 3
"$WG" check "$S" >/dev/null 2>&1
GH_EXTRA_AT=2 "$WG" merge "$S" >"$W/mout" 2>&1; rc=$?
[ "$rc" -eq 4 ] && [ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "1 2 " ] && ok "merge: the tree after PR 2 differs -> PR 3 is not merged" || bad "merge tree: exit $rc gh $(cat "$GH_LOG")"
[ "$(q "$S" s.merge.stopped.number)" = 2 ] && [[ "$(q "$S" s.merge.stopped.reason)" == *"tree"* ]] && ok "merge: the stop names PR 2 and the tree" || bad "merge tree: stopped $(q "$S" s.merge 2>&1)"
grep -q "gate full on" "$W/mout" && ok "merge: the stop asks for gate full on the main branch" || bad "merge tree: output $(cat "$W/mout")"
"$WG" merge "$S" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 4 ] && [ "$(grep -c 'pr merge' "$GH_LOG")" = 2 ] && ok "merge: a stopped merge does not go on" || bad "merge tree: second merge exit $rc"

# --- merge resumed after a break: the main branch must still be the commit of the last recorded merge ---
new_world mresume 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; state "$S" null 1 2 3
"$WG" check "$S" >/dev/null 2>&1
# PR 1 merged, then the session broke before PR 2: the state has merge.merged = [#1], status pending
gh pr merge 1 --squash --match-head-commit "$(head_of 1)" >/dev/null 2>&1
m1="$(git -C "$W/origin.git" rev-parse main)"
node -e 'const fs=require("fs"),[f,c,t]=process.argv.slice(1),s=JSON.parse(fs.readFileSync(f,"utf8")); s.merge={merged:[{number:1,commit:c,tree:t}],status:"pending"}; fs.writeFileSync(f,JSON.stringify(s))' \
    "$S" "$m1" "$(git -C "$W/origin.git" rev-parse 'main^{tree}')"
cp "$S" "$W/state-clean.json"
: >"$GH_LOG"
echo foreign >"$W/seed/foreign.txt"; git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m foreign && git -C "$W/seed" pull -q --rebase origin main 2>/dev/null; git -C "$W/seed" push -q origin HEAD:main
"$WG" merge "$S" >"$W/mout" 2>&1; rc=$?
[ "$rc" -eq 4 ] && ! grep -q "pr merge" "$GH_LOG" && ok "merge resume: a push after the recorded merge of #1 -> exit 4, no gh pr merge" || bad "merge resume: exit $rc gh [$(cat "$GH_LOG")]: $(tail -3 "$W/mout")"
[ "$(q "$S" s.merge.stopped.number)" = 2 ] && [[ "$(q "$S" s.merge.stopped.reason)" == *"after the merge of #1"* ]] && ok "merge resume: the stop names #2 and the merge of #1" || bad "merge resume: stopped $(q "$S" s.merge 2>&1)"
# without the foreign push the resume goes on from #2
new_world mresume2 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; state "$S" null 1 2 3
"$WG" check "$S" >/dev/null 2>&1
gh pr merge 1 --squash --match-head-commit "$(head_of 1)" >/dev/null 2>&1
node -e 'const fs=require("fs"),[f,c,t]=process.argv.slice(1),s=JSON.parse(fs.readFileSync(f,"utf8")); s.merge={merged:[{number:1,commit:c,tree:t}],status:"pending"}; fs.writeFileSync(f,JSON.stringify(s))' \
    "$S" "$(git -C "$W/origin.git" rev-parse main)" "$(git -C "$W/origin.git" rev-parse 'main^{tree}')"
: >"$GH_LOG"
"$WG" merge "$S" >"$W/mout" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "2 3 " ] && ok "merge resume: an unchanged main -> merges #2 and #3 only" || bad "merge resume clean: exit $rc gh [$(cat "$GH_LOG")]"

# --- one check per repository: the pid file ------------------------------------------------------
PIDF() { echo "$(cd "$W/repo/.git" && pwd -P)/worfy-wave-gate.pid"; }
# at_point <sync folder> <point> <n>: at least n checks have stopped at the point (WAVE_GATE_PID_SYNC)
at_point() { [ "$(ls "$1" | grep -c "^$2-")" -ge "$3" ]; }
# the start time of the pid file's writer, "<pid> <started>"; the pid file itself holds the bare pid
SIDE() { echo "$(PIDF).started"; }
new_world pidlive 1:a.txt
S="$W/state.json"; state "$S" null 1
git -C "$W/repo" worktree add -q --detach "$(TMPW_OF)" origin/main && echo mine >"$(TMPW_OF)/marker"
sleep 60 & sp=$! job=$!
# the pid node sees: in Git Bash the Windows pid of sleep, once it has started
if on_windows; then until_ok 5 grep -q sleep "/proc/$sp/exename"; sp="$(cat "/proc/$sp/winpid")"; fi
echo "$sp" >"$(PIDF)"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "another wave-gate check runs in this repository (pid $sp, no start time to compare" "$W/out" \
    && ok "pid: a live check's pid and no side file -> exit 1 naming it, with no start time to compare" || bad "pid live: exit $rc: $(tail -3 "$W/out")"
[ "$(cat "$(TMPW_OF)/marker" 2>/dev/null)" = mine ] && git -C "$W/repo" worktree list | grep -q worfy-wave-gate && [ "$(gate_count)" = 0 ] && [ "$(cat "$(PIDF)")" = "$sp" ] \
    && ok "pid: the other check's worktree and pid file are untouched, no gate run" || bad "pid live: worktree, pid file or gate touched"
# The side file names when the pid file's writer started. A live pid whose process started no later is that check:
# waited for. Read on Windows only, where a pid comes back within seconds (wave-gate, holderAlive).
if on_windows; then
    echo "$sp" >"$(PIDF)"; echo "$sp $(( $(date +%s) * 1000 ))" >"$(SIDE)"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 1 ] && grep -q "another wave-gate check runs in this repository (pid $sp, it started at .*, no later than the file says" "$W/out" \
        && ok "pid: a live pid whose process started no later than the file says -> exit 1 naming it" || bad "pid live with start: exit $rc: $(tail -3 "$W/out")"
else
    # Off Windows the start time is not read: the error says so, not that the file names none.
    echo "$sp" >"$(PIDF)"; echo "$sp $(( $(date +%s) * 1000 ))" >"$(SIDE)"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 1 ] && grep -q "another wave-gate check runs in this repository (pid $sp, its start time is not read here" "$W/out" \
        && ok "pid: off Windows a live pid with a side file -> exit 1, its start time not read" || bad "pid live with start off Windows: exit $rc: $(tail -3 "$W/out")"
fi
kill "$job"; wait "$job" 2>/dev/null
git -C "$W/repo" worktree remove --force "$(TMPW_OF)"
# a dead pid: stale, taken over. The pid of a node that has exited: node's pid is the one wave-gate checks, while in
# Git Bash `$!` is an MSYS pid, which may fall on a live Windows process.
dp="$(node -e 'process.stdout.write(String(process.pid))')"
echo "$dp" >"$(PIDF)"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && grep -q "pid $dp, which is not running" "$W/out" && [ ! -e "$(PIDF)" ] && [ ! -e "$(SIDE)" ] && ok "pid: a dead pid is taken over; the pid file is gone at the end" || bad "pid dead: exit $rc: $(tail -3 "$W/out")"
# a pid handed to another process: live, but that process started after the check that wrote the file (2020-01-01)
if on_windows; then
    sleep 60 & rp=$! rjob=$!
    until_ok 5 grep -q sleep "/proc/$rp/exename"; rp="$(cat "/proc/$rp/winpid")"
    # a side file older than the pid file was left by a killed check: the pid file is of a later writer (an older
    # wave-gate writes none), and its pid alone is the verdict
    echo "$rp 1577836800000" >"$(SIDE)"; touch -t 202001010000 "$(SIDE)"; echo "$rp" >"$(PIDF)"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 1 ] && grep -q "another wave-gate check runs in this repository (pid $rp" "$W/out" \
        && ok "pid: a side file older than the pid file is not read; the live pid is waited for" || bad "pid old side file: exit $rc: $(tail -3 "$W/out")"
    echo "$rp" >"$(PIDF)"; echo "$rp 1577836800000" >"$(SIDE)"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 0 ] && grep -q "pid $rp, which is not running" "$W/out" && [ ! -e "$(PIDF)" ] && [ ! -e "$(SIDE)" ] \
        && ok "pid: a pid now held by a process that started later is taken over" || bad "pid reused: exit $rc: $(tail -3 "$W/out")"
    kill "$rjob"; wait "$rjob" 2>/dev/null
    # A pid whose process ends while the check asks when it started: PowerShell says no process has it, and the pid is
    # dead. On a loaded runner a short-lived process that got the pid of the killed check ended so, and the resume case
    # was refused (CI run 40656857467). The check stops between its two looks at the pid
    # (WAVE_GATE_PID_SYNC) while the process is ended; the file names a start no earlier than the process's own.
    sleep 60 & ep=$! ejob=$!
    until_ok 5 grep -q sleep "/proc/$ep/exename"; ep="$(cat "/proc/$ep/winpid")"
    echo "$ep" >"$(PIDF)"; echo "$ep $(( $(date +%s) * 1000 ))" >"$(SIDE)"
    sync="$W/pid-sync"; mkdir -p "$sync"; touch "$sync/hold-alive"
    WAVE_GATE_PID_SYNC="$sync" "$WG" check "$S" >"$W/out" 2>&1 & ewg=$!
    until_ok 30 at_point "$sync" alive 1 || bad "pid ended while asked: the check never stopped where it found the pid running"
    kill "$ejob"; wait "$ejob" 2>/dev/null
    touch "$sync/resume-alive"
    wait "$ewg"; rc=$?
    [ "$rc" -eq 0 ] && grep -q "pid $ep, which is not running" "$W/out" && [ ! -e "$(PIDF)" ] \
        && ok "pid: a pid whose process ends while its start time is asked is taken over" || bad "pid ended while asked: exit $rc: $(tail -3 "$W/out")"
    # The system says no process has the pid, and a look at the pid then finds it running: on a busy machine another
    # process has just got it, and the check was refused as if a check still ran (2 of 120 under load on the PC). Windows
    # pids are multiples of 4 and OpenProcess ignores the lower bits, so a pid one above a running one shows both answers.
    sleep 60 & op=$! ojob=$!
    until_ok 5 grep -q sleep "/proc/$op/exename"; op=$(( $(cat "/proc/$op/winpid") + 1 ))
    if node -e 'process.kill(Number(process.argv[1]), 0)' "$op" 2>/dev/null; then
        echo "$op" >"$(PIDF)"; echo "$op $(( $(date +%s) * 1000 ))" >"$(SIDE)"
        "$WG" check "$S" >"$W/out" 2>&1; rc=$?
        [ "$rc" -eq 0 ] && grep -q "pid $op, which is not running" "$W/out" && [ ! -e "$(PIDF)" ] \
            && ok "pid: the system says no process has the pid: taken over, whatever a later look finds" || bad "pid no process: exit $rc: $(tail -3 "$W/out")"
    else
        bad "pid no process: a pid one above a running one is no longer found running: this case needs another way to show both answers"
    fi
    kill "$ojob"; wait "$ojob" 2>/dev/null
    # The dangerous direction: a live pid must never read as "no process", or the lock of a live check is taken. Without
    # elevation the start time of pid 4 cannot be read. Elevated, as on the GitHub runner, it can, and so can csrss.exe's
    # (CI showed it): no process there refuses the question, and the check is only seen to wait.
    live=4
    echo "$live" >"$(PIDF)"; echo "$live $(( $(date +%s) * 1000 ))" >"$(SIDE)"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    if [ "$rc" -eq 1 ] && [ "$(cat "$(PIDF)")" = "$live" ] && grep -q "another wave-gate check runs in this repository (pid $live, its start time could not be read" "$W/out"; then
        ok "pid: a live pid whose start time may not be read is waited for; its pid file stays"
    elif [ "$rc" -eq 1 ] && [ "$(cat "$(PIDF)")" = "$live" ] && grep -q "another wave-gate check runs in this repository (pid $live, it started at .*, no later than the file says" "$W/out"; then
        echo "skip the dangerous direction of a pid's start time: elevated here, the start time of pid $live can be read, so a lost exception type in the catch of wave-gate is caught only on a machine without elevation"
    else
        bad "pid $live: exit $rc: $(tail -3 "$W/out")"
    fi
    rm -f "$(PIDF)" "$(SIDE)"
else
    echo "skip the cases of a pid's start time: it is read on Windows only"
fi
# an empty pid file: young — its writer is between open and write; old — stale
new_world pidempty 1:a.txt
S="$W/state.json"; state "$S" null 1
: >"$(PIDF)"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "its pid is being written" "$W/out" && ok "pid: an empty pid file just made -> exit 1" || bad "pid empty young: exit $rc: $(tail -3 "$W/out")"
touch -t 202001010000 "$(PIDF)"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && grep -q "no pid for over" "$W/out" && ok "pid: an empty pid file older than 10 s is taken over" || bad "pid empty old: exit $rc: $(tail -3 "$W/out")"
# two checks started together: exactly one runs. The gate run of the one that runs is held until the other has
# given way: a fixed sleep in the gate let the first check finish before a late second one started, and both ran.
new_world pidrace 1:a.txt
state "$W/s1.json" null 1; state "$W/s2.json" null 1
touch "$GATE_DIR/hold"
"$WG" check "$W/s1.json" >"$W/o1" 2>&1 & p1=$!
"$WG" check "$W/s2.json" >"$W/o2" 2>&1 & p2=$!
until_ok 30 grep -q "another wave-gate check" "$W/o1" "$W/o2"
# what the running check wrote: a wave-gate before the side file reads the pid file as Number(text.trim())
held_pid="$(node -e 'const n = Number(require("fs").readFileSync(process.argv[1], "utf8").trim()); process.stdout.write(Number.isInteger(n) && n > 0 ? String(n) : "NaN")' "$(PIDF)")"
side_pid="$(awk '{print $1}' "$(SIDE)" 2>/dev/null)"
rm -f "$GATE_DIR/hold"
finish "$p1" 120; r1=$rc; finish "$p2" 120; r2=$rc
codes="$(printf '%s\n' "$r1" "$r2" | sort | tr '\n' ' ')"
[ "$codes" = "0 1 " ] && grep -q "another wave-gate check" "$W/o1" "$W/o2" && [ "$(gate_count)" = 1 ] && ok "pid: two checks at once -> one runs, the other exits 1" || bad "pid race: codes [$codes] runs $(gate_count): $(tail -2 "$W/o1") | $(tail -2 "$W/o2")"
[ "$held_pid" != NaN ] && [ "$side_pid" = "$held_pid" ] && [ ! -e "$(PIDF)" ] && [ ! -e "$(SIDE)" ] \
    && ok "pid: the pid file holds the bare pid an older wave-gate reads; the side file names it; both gone at the end" || bad "pid file format: pid [$held_pid] side [$side_pid]"
# two checks over a stale pid file: exactly one takes it over and runs, the other gives way with its message. Both
# stop where they found the file stale and go on together. On Windows two renames of one path both succeed (libuv
# renames through a handle it opened), so a takeover by rename let both checks through, or ended one with an error on
# the file the other had moved. The pid is one no system hands out.
new_world pidstale 1:a.txt
state "$W/s1.json" null 1; state "$W/s2.json" null 1
echo 2147483644 >"$(PIDF)"
sync="$W/pid-sync"; mkdir -p "$sync"; touch "$sync/hold-stale" "$GATE_DIR/hold"
WAVE_GATE_PID_SYNC="$sync" "$WG" check "$W/s1.json" >"$W/o1" 2>&1 & p1=$!
WAVE_GATE_PID_SYNC="$sync" "$WG" check "$W/s2.json" >"$W/o2" 2>&1 & p2=$!
until_ok 30 at_point "$sync" stale 2 || bad "pid stale race: the two checks did not both stop at the stale pid file: [$(ls "$sync")]"
touch "$sync/resume-stale"
# the gate of the check that runs is held until the other has ended: two that both took over would both wait here
one_ended() { gone "$p1" || gone "$p2"; }
until_ok 30 one_ended
rm -f "$GATE_DIR/hold"
finish "$p1" 120; r1=$rc; finish "$p2" 120; r2=$rc
codes="$(printf '%s\n' "$r1" "$r2" | sort | tr '\n' ' ')"
left="$(ls -d "$(PIDF)"* 2>/dev/null)"
[ "$codes" = "0 1 " ] && [ "$(gate_count)" = 1 ] && grep -q "another wave-gate check" "$W/o1" "$W/o2" && ! grep -q "Error:" "$W/o1" "$W/o2" && [ -z "$left" ] \
    && ok "pid: two checks over a stale pid file -> one takes it over and runs, the other exits 1 with its message" \
    || bad "pid stale race: codes [$codes] runs $(gate_count) left [$left] [$(grep -h "Error" "$W/o1" "$W/o2" | head -1)]: $(tail -2 "$W/o1" | tr '\n' '|') || $(tail -2 "$W/o2" | tr '\n' '|')"
# the takeover token of a stale pid file: a young one is another check taking it over right now, and this check gives
# way; an old one was left by a check killed in those milliseconds, and is removed
new_world pidtoken 1:a.txt
S="$W/state.json"; state "$S" null 1
echo 2147483644 >"$(PIDF)"; mkdir "$(PIDF).takeover"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "another wave-gate check is taking over" "$W/out" && [ "$(gate_count)" = 0 ] && [ -d "$(PIDF).takeover" ] && [ "$(cat "$(PIDF)")" = 2147483644 ] \
    && ok "pid: a stale pid file under a young takeover token -> exit 1, both left alone" || bad "pid young token: exit $rc: $(tail -3 "$W/out")"
touch -t 202001010000 "$(PIDF).takeover"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && grep -q "pid 2147483644, which is not running" "$W/out" && [ -z "$(ls -d "$(PIDF)"* 2>/dev/null)" ] \
    && ok "pid: an old takeover token is removed and the stale pid file taken over" || bad "pid old token: exit $rc, left [$(ls -d "$(PIDF)"* 2>/dev/null)]: $(tail -3 "$W/out")"

# --- between runs: ignored build output is removed, node_modules stays ---------------------------
new_world artifacts 1:a.txt 2:RED
S="$W/state.json"; state "$S" null 1 2; touch "$GATE_DIR/artifacts"
"$WG" check "$S" >/dev/null 2>&1
[ "$(awk 'NR>1{print $2, $3}' "$GATE_DIR/artifacts.log" | sort -u)" = "leftover=no nm=kept" ] && [ "$(wc -l <"$GATE_DIR/artifacts.log" | tr -d ' ')" = 3 ] \
    && ok "between runs: no build output of the run before, node_modules kept" || bad "between runs: $(cat "$GATE_DIR/artifacts.log")"

# --- an error in the middle of the squash merges: the worktree is removed ---------------------
new_world broken 1:a.txt
# PR 2: a commit whose tree object is missing — git merge fails without a conflict
blob=$(echo "broken $RANDOM" | git -C "$W/repo" hash-object -w --stdin)
tree=$(printf '100644 blob %s\tbroken.txt\n' "$blob" | git -C "$W/repo" mktree)
c2=$(git -C "$W/repo" commit-tree "$tree" -p "$(git -C "$W/repo" rev-parse origin/main)" -m broken)
rm -f "$W/repo/.git/objects/${tree:0:2}/${tree:2}"
S="$W/state.json"
printf '{"repo":"%s","branch":"main","e2e_lock":null,"prepare":null,"cross_machine_label":null,"prs":[{"number":1,"head":"%s"},{"number":2,"head":"%s"}]}\n' "$(tn "$W/repo")" "$(head_of 1)" "$c2" >"$S"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && [ "$(q "$S" s.status)" = error ] && ok "error while merging: exit 1, status error" || bad "error while merging: exit $rc status $(q "$S" s.status 2>&1): $(tail -3 "$W/out")"
[ ! -e "$(TMPW_OF)" ] && ok "error while merging: the temporary worktree is removed" || bad "error while merging: worktree left"
[ "$(gate_count)" = 0 ] && ok "error while merging: no gate run" || bad "error while merging: $(gate_count) runs"
if $RUN_SCREEN; then
    [ -s "$SCREEN_DIR/caf.log" ] && caf_gone "$SCREEN_DIR/caf.log" && ok "error while merging: no caffeinate left after the error" || bad "error while merging: caffeinate left or not started: $(cat "$SCREEN_DIR/caf.log" 2>/dev/null)"
fi

# --- workflow.ci "batch": no CI on the PR head; one CI run on main after the wave -------------
# A PR whose checks are red (the stub `gh pr checks` exits 1) is merged in the set: wave-gate never asks for
# checks or mergeStateStatus.
new_world batch 1:a.txt 2:b.txt
S="$W/state.json"; state "$S" null 1 2
"$WG" check "$S" >"$W/out" 2>&1 && "$WG" merge "$S" >>"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "1 2 " ] \
    && ok "batch: PRs without green checks are merged in the set" || bad "batch: exit $rc: $(tail -3 "$W/out")"
! grep -qE '^(pr checks|run |workflow run)|mergeStateStatus' "$GH_LOG" \
    && ok "batch: check and merge ask for no checks, no run, no mergeStateStatus and dispatch nothing" || bad "batch: gh calls: $(cat "$GH_LOG")"
# ci_guard <command>: on Windows wave-gate runs only a leading gh of a ci_batch_run command as the stand-in, through
# cmd.exe. A command that does not start with gh, chains another command (&, |, ;, a newline, ` or $( ) or names
# gh again would reach the real gh there, so it stops the test. Every command a CI state file gets passes it.
ci_guard() {
    on_windows || return 0
    if [[ "$1" != "gh "* ]] || [[ "$1" == *[\&\|\;\`$'\n']* || "$1" == *'$('* ]] || has_gh_word "${1#gh }"; then
        echo "REFUSED: ci_batch_run [$1] is not one gh command: on Windows it would reach the real gh" >&2; exit 1
    fi
}
# ci_state <file> <ci> <run or null>: the wave CI state file the skill block writes, its command through ci_guard.
ci_state() { local run="$3"
    [ "$run" = null ] || ci_guard "$run"
    [ "$run" = null ] || run="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$run")"
    printf '{"repo":"%s","branch":"main","ci":"%s","ci_batch_run":%s}\n' "$(tn "$W/repo")" "$2" "$run" >"$1"; }
dispatches() { grep -c '^workflow run' "$GH_LOG"; }
TIP="$(git -C "$W/origin.git" rev-parse main)"
C="$W/ci.json"; ci_state "$C" batch 'gh workflow run ci.yml --ref $ref -f job=check'
export GH_RUN_URL="https://github.com/o/r/actions/runs/4242"
"$WG" ci "$C" >"$W/cout" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(dispatches)" = 1 ] && grep -qx 'workflow run ci.yml --ref main -f job=check' "$GH_LOG" \
    && ok "batch ci: one dispatch for main, \$ref is the branch" || bad "batch ci: exit $rc: $(cat "$W/cout") gh: $(grep 'workflow run' "$GH_LOG")"
[ "$(q "$C" 's.ci_run.run_id+" "+s.ci_run.url+" "+s.ci_run.commit')" = "4242 $GH_RUN_URL $TIP" ] && [ -n "$(q "$C" s.ci_run.dispatched_at)" ] \
    && ok "batch ci: the run id, its URL and the commit of main are recorded" || bad "batch ci: ci_run $(q "$C" s.ci_run 2>&1)"
grep -q "CI_RUN=4242 $GH_RUN_URL" "$W/cout" && ok "batch ci: prints CI_RUN=<id> <url>" || bad "batch ci: output $(cat "$W/cout")"
"$WG" ci "$C" >"$W/cout2" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(dispatches)" = 1 ] && grep -q "CI_RUN=4242" "$W/cout2" \
    && ok "batch ci: a second call dispatches nothing more" || bad "batch ci: second call exit $rc, dispatches $(dispatches)"
# workflow.ci "pr": nothing is dispatched
P="$W/ci-pr.json"; ci_state "$P" pr null
"$WG" ci "$P" >"$W/pout" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(dispatches)" = 1 ] && grep -q "CI=skipped" "$W/pout" && [ "$(q "$P" 's.ci_run===undefined')" = true ] \
    && ok "pr ci: nothing is dispatched, CI=skipped" || bad "pr ci: exit $rc: $(cat "$W/pout")"
# no URL in the dispatch output: the run is found by the commit of main; not found yet — exit 3, and a second
# call finds it without a second dispatch
unset GH_RUN_URL
export WAVE_GATE_CI_POLL_S=0.1 WAVE_GATE_CI_TRIES=2
D="$W/ci-find.json"; ci_state "$D" batch 'gh workflow run ci.yml --ref $ref -f job=check'
before=$(dispatches)
"$WG" ci "$D" >"$W/dout" 2>&1; rc=$?
[ "$rc" -eq 3 ] && [ "$(dispatches)" = $((before + 1)) ] && [ "$(q "$D" 's.ci_run.run_id===undefined')" = true ] \
    && grep -q -- "--commit $TIP --event workflow_dispatch" "$GH_LOG" && grep -q -- "--workflow ci.yml" "$GH_LOG" \
    && ok "batch ci: run not found -> exit 3, looked up by the commit of main and the workflow" || bad "batch ci: not found exit $rc: $(cat "$W/dout") gh: $(grep 'run list' "$GH_LOG")"
printf '[{"databaseId":7,"url":"https://github.com/o/r/actions/runs/7","createdAt":"2000-01-01T00:00:00Z"},{"databaseId":9,"url":"https://github.com/o/r/actions/runs/9","createdAt":"%s"}]\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$W/runs.json"
export GH_RUNS="$W/runs.json"
"$WG" ci "$D" >"$W/dout2" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(dispatches)" = $((before + 1)) ] && [ "$(q "$D" 's.ci_run.run_id')" = 9 ] \
    && ok "batch ci: the second call finds the run created after the dispatch, without a second dispatch" || bad "batch ci: find exit $rc run $(q "$D" s.ci_run 2>&1): $(cat "$W/dout2")"
unset GH_RUNS
# a failed dispatch: exit 1, nothing recorded as dispatched, the next call dispatches again
F1="$W/ci-fail.json"; ci_state "$F1" batch 'gh workflow run ci.yml --ref $ref -f job=check'
export GH_DISPATCH_RC=1 GH_RUN_URL="https://github.com/o/r/actions/runs/11"
before=$(dispatches)
"$WG" ci "$F1" >"$W/fout" 2>&1; rc=$?
[ "$rc" -eq 1 ] && [ "$(q "$F1" 's.ci_run.dispatched_at===undefined && s.ci_run.status==="dispatch failed"')" = true ] \
    && ok "batch ci: a failed dispatch -> exit 1, not recorded as dispatched" || bad "batch ci: failed dispatch exit $rc: $(cat "$W/fout") $(q "$F1" s.ci_run 2>&1)"
export GH_DISPATCH_RC=0
"$WG" ci "$F1" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(dispatches)" = $((before + 2)) ] && [ "$(q "$F1" s.ci_run.run_id)" = 11 ] \
    && ok "batch ci: after a failed dispatch the next call dispatches" || bad "batch ci: retry exit $rc"
unset GH_RUN_URL GH_DISPATCH_RC WAVE_GATE_CI_POLL_S WAVE_GATE_CI_TRIES
# bad input: batch without a command, an unknown mode, a merge of the set still in progress
B="$W/ci-bad.json"; ci_state "$B" batch null
"$WG" ci "$B" >"$W/bout" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "ci_batch_run" "$W/bout" && ok "batch ci: batch without ci_batch_run -> exit 1 naming it" || bad "batch ci: no command exit $rc $(cat "$W/bout")"
ci_state "$B" nightly null
"$WG" ci "$B" >"$W/bout" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q '"ci"' "$W/bout" && ok "ci: an unknown mode -> exit 1" || bad "ci: unknown mode exit $rc $(cat "$W/bout")"
run='gh workflow run ci.yml --ref $ref'; ci_guard "$run"
node -e 'const fs=require("fs"),f=process.argv[1],s=JSON.parse(fs.readFileSync(f,"utf8"));s.ci="batch";s.ci_batch_run=process.argv[2];s.merge={merged:[],status:"pending"};fs.writeFileSync(f,JSON.stringify(s))' "$B" "$run"
before=$(dispatches)
"$WG" ci "$B" >"$W/bout" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "merge" "$W/bout" && [ "$(dispatches)" = "$before" ] \
    && ok "batch ci: a merge still in progress -> exit 1, nothing dispatched" || bad "batch ci: pending merge exit $rc $(cat "$W/bout")"
# A branch name that is not a plain one never reaches the shell: exit 1, no dispatch.
ci_guard "$run"
printf '{"repo":"%s","branch":"main;x","ci":"batch","ci_batch_run":"%s"}\n' "$(tn "$W/repo")" "$run" >"$B"
before=$(dispatches)
"$WG" ci "$B" >"$W/bout" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q '"branch"' "$W/bout" && [ "$(dispatches)" = "$before" ] \
    && ok "batch ci: branch \"main;x\" -> exit 1, nothing dispatched" || bad "batch ci: branch main;x exit $rc $(cat "$W/bout")"
# Only a run created before the dispatch is listed on that commit: it is not this dispatch's run -> exit 3.
export WAVE_GATE_CI_POLL_S=0.1 WAVE_GATE_CI_TRIES=1
printf '[{"databaseId":7,"url":"https://github.com/o/r/actions/runs/7","createdAt":"2000-01-01T00:00:00Z"}]\n' >"$W/old-runs.json"
export GH_RUNS="$W/old-runs.json"
E="$W/ci-old.json"; ci_state "$E" batch 'gh workflow run ci.yml --ref $ref -f job=check'
"$WG" ci "$E" >"$W/eout" 2>&1; rc=$?
[ "$rc" -eq 3 ] && grep -q "CI_RUN=not-found" "$W/eout" && [ "$(q "$E" 's.ci_run.run_id===undefined')" = true ] \
    && ok "batch ci: only a run older than the dispatch is listed -> exit 3, not taken" || bad "batch ci: old run exit $rc run $(q "$E" s.ci_run 2>&1)"
# The lookups are capped: the 6th call that finds no run makes it "not verified"; a later call neither looks nor dispatches.
for i in 2 3 4 5 6; do "$WG" ci "$E" >"$W/eout" 2>&1; rc=$?; done
before=$(dispatches)
"$WG" ci "$E" >"$W/eout2" 2>&1; rc2=$?
[ "$rc" -eq 3 ] && grep -q "CI_RUN=not-verified" "$W/eout" && [ "$(q "$E" 's.ci_run.status+" "+s.ci_run.lookups')" = "not verified 6" ] \
    && [ "$rc2" -eq 3 ] && grep -q "CI_RUN=not-verified" "$W/eout2" && [ "$(dispatches)" = "$before" ] \
    && ok "batch ci: after 6 calls without a listed run -> not verified, no further lookup or dispatch" || bad "batch ci: cap exit $rc/$rc2: $(cat "$W/eout") $(q "$E" s.ci_run 2>&1)"
unset GH_RUNS WAVE_GATE_CI_POLL_S WAVE_GATE_CI_TRIES
# The next wave reuses the file after main moved: a new dispatch for the new tip, the old run kept as superseded.
# The checkout is on another branch: $ref is still the file's branch, not the checked-out one.
git clone -q "$W/origin.git" "$W/next" && echo next >"$W/next/next.txt" && git -C "$W/next" add -A && git -C "$W/next" commit -q -m "next wave" && git -C "$W/next" push -q origin HEAD:main
git -C "$W/repo" checkout -q -b elsewhere
TIP2="$(git -C "$W/origin.git" rev-parse main)"
export GH_RUN_URL="https://github.com/o/r/actions/runs/5000"
before=$(dispatches); refs=$(grep -c '^workflow run ci.yml --ref main -f job=check$' "$GH_LOG")
"$WG" ci "$C" >"$W/nout" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(dispatches)" = $((before + 1)) ] && [ "$(grep -c '^workflow run ci.yml --ref main -f job=check$' "$GH_LOG")" = $((refs + 1)) ] \
    && [ "$(q "$C" 's.ci_run.run_id+" "+s.ci_run.commit+" "+s.ci_run.superseded.map(x=>x.run_id+":"+x.commit).join(",")')" = "5000 $TIP2 4242:$TIP" ] \
    && ok "batch ci: main moved since the recorded run -> a new dispatch for main's new tip, the old run superseded" || bad "batch ci: next wave exit $rc: $(cat "$W/nout") $(q "$C" s.ci_run 2>&1)"
"$WG" ci "$C" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(dispatches)" = $((before + 1)) ] && ok "batch ci: on the same new tip no further dispatch" || bad "batch ci: repeat on the new tip exit $rc, dispatches $(dispatches)"
git -C "$W/repo" checkout -q main
unset GH_RUN_URL

# --- a refused gh pr merge: the PR is not recorded as merged, the merge stops ----------------
new_world mfail 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; state "$S" null 1 2 3
"$WG" check "$S" >"$W/out" 2>&1
export GH_MERGE_FAIL_AT=2
"$WG" merge "$S" >"$W/mout" 2>&1; rc=$?
[ "$rc" -eq 4 ] && [ "$(q "$S" 's.merge.merged.map(m=>m.number).join(" ")')" = 1 ] && [ "$(q "$S" 's.merge.status+" "+s.merge.stopped.number')" = "stopped 2" ] \
    && grep -q "gh pr merge failed" "$S" && ok "merge refused by gh: exit 4, only PR 1 recorded as merged, stopped at 2" || bad "merge refused: exit $rc $(q "$S" s.merge 2>&1)"
[ "$(git -C "$W/origin.git" log --format=%s main | head -n 1)" = "squash #1" ] && ok "merge refused by gh: main ends at PR 1" || bad "merge refused: main $(git -C "$W/origin.git" log --format=%s -1 main)"
unset GH_MERGE_FAIL_AT

caf_gone "$T"/*/screen/caf*.log && ok "no stub caffeinate of any test is left" || bad "stub caffeinate left: $(cat "$T"/*/screen/caf*.log)"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
