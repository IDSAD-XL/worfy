#!/usr/bin/env bash
# Tests of the e2e lock heartbeat in the gate full block of one PR of skills/epic-wave/SKILL.md (the block cut out
# of the file, as wave-gate.test.sh does, and run under bash and zsh): the heartbeat ends once the lock folder is
# gone, also when the block's shell was killed without its trap (kill -9); on a normal exit no heartbeat `sleep` is
# left behind and no job notice is printed; a live lock of someone else stays; in Git Bash too the trap returns
# within its time limit (it once hung in `wait` after kill -STOP). Temporary folders only, not the e2e lock of the
# machine, no real gate.
# Run: bash harness/bin/tests/wave-gate-heartbeat.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HARNESS="$(cd "$HERE/../.." && pwd)"
SKILL="${SKILL_FILE:-$HARNESS/skills/epic-wave/SKILL.md}"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
. "$HERE/real-home.sh"
. "$HERE/gh-stand-in.sh" # on_windows
home_before="$(real_home_snapshot "$HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
q() { node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const v=new Function("s","return ("+process.argv[2]+")")(s); process.stdout.write(typeof v==="string"?v:JSON.stringify(v))' "$1" "$2"; }
# until_ok <seconds> <command…>: polls the command every 0.2 s; exit 0 as soon as it succeeds, 1 after the time
until_ok() { local n=$(( $1 * 5 )); shift; while [ "$n" -gt 0 ]; do "$@" && return 0; sleep 0.2; n=$((n - 1)); done; return 1; }
block() { # $1 = a string that identifies the ```bash block; prints it without the `F() {…profile…}` line
    awk -v m="$1" '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,m)) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}' "$SKILL" \
        | grep -v '^F() { "\${CLAUDE_PLUGIN_ROOT}/bin/profile"'
}
BE="$(block 'printf '"'"'{"prs":[%s],"what":"gate-full"')"
[ -n "$BE" ] && ok "skill blocks: the one-PR gate full block is in $SKILL" || bad "skill blocks: the one-PR gate full block not found in $SKILL"
# The block polls the lock every 20 s (wave-gate.test.sh checks that); here it polls every 0.2 s or 0.1 s and gives
# up with exit 98, so a block that never takes the lock fails its check instead of hanging the file.
LOCK_POLL=$'\n    sleep 20\n'
LOCK_FAST=$'\n    sleep 0.2; polls=$(( ${polls:-0} + 1 )); [ "$polls" -le 50 ] || exit 98\n'
LOCK_FAST3=$'\n    sleep 0.1; polls=$(( ${polls:-0} + 1 )); [ "$polls" -le 3 ] || exit 98\n'

# The heartbeat's `sleep 300` is replaced by $HBBIN/hbsleep, which appends its pid to $HB_PIDS and then sleeps as
# asked, so the test knows every heartbeat sleep and kills any that is left by pid at the end. A pid counts as a
# heartbeat sleep only while ps still shows it as `sleep <the test's duration>`: a pid reused by another process is
# not one. The block runs with a stub ioreg (the screen is unlocked) and a stub gate: no git world, no real ioreg.
HBBIN="$T/hb-bin"; mkdir -p "$HBBIN"
printf '#!/bin/sh\nexit 0\n' >"$HBBIN/ioreg"
printf '#!/bin/sh\necho "$$" >>"$HB_PIDS"\nexec sleep "$@"\n' >"$HBBIN/hbsleep"
# waitgo <file>: the gate of the kill -9 run; marks <file>.started, ends once <file> exists, then marks <file>.done
printf '#!/bin/sh\n: >"$1.started"\nn=0; while [ ! -e "$1" ] && [ "$n" -lt 400 ]; do sleep 0.05; n=$((n + 1)); done\n: >"$1.done"\n' >"$HBBIN/waitgo"
chmod +x "$HBBIN/ioreg" "$HBBIN/hbsleep" "$HBBIN/waitgo"
HB_LOOP='while sleep 300;'
[[ "$BE" == *"$HB_LOOP"* ]] && ok "skill blocks: the one-PR gate full block's heartbeat sleeps 300 s between touches" \
    || bad "skill blocks: the one-PR gate full block has no '$HB_LOOP' heartbeat"
# The Git Bash branch of the trap (the heartbeat has /proc/<pid>/winpid) sends no kill -STOP: there a kill -KILL after
# it can leave the heartbeat deaf to every signal. The 40 runs below show that only on Windows; this check runs
# everywhere.
WIN_IF='if [ -e /proc/$HB/winpid ]; then'
TRAP_WIN="${BE#*"$WIN_IF"}"; TRAP_WIN="${TRAP_WIN%%; else *}"
[ "$TRAP_WIN" != "$BE" ] && [[ "$TRAP_WIN" == *'kill -KILL $HB'* ]] && [[ "$TRAP_WIN" == *'/usr/bin/kill -f -9 $HB'* ]] && [[ "$TRAP_WIN" != *STOP* ]] \
    && ok "skill blocks: the Git Bash branch of the one-PR block's trap kills the heartbeat without kill -STOP" \
    || bad "skill blocks: the one-PR block's trap has no Git Bash branch ('$WIN_IF') without kill -STOP: [${TRAP_WIN:0:300}]"
# The heartbeat ends with the block's shell and touches the lock only while holder.json names that shell. The cases
# below show both by behaviour; the holder.json the block writes is in the form the heartbeat looks for.
HB_OURS='kill -0 $$ 2>/dev/null || exit 0; grep -q "\"pid\":$$," "$L/holder.json" 2>/dev/null && touch -c "$L"'
[[ "$BE" == *"$HB_OURS"* ]] && ok "skill blocks: the one-PR block's heartbeat ends with its shell and touches the lock only while holder.json names it" \
    || bad "skill blocks: the one-PR block's heartbeat has no '$HB_OURS'"
# cmd_of <pid>: the command line of <pid>, empty when it is gone (/proc/<pid>/cmdline in Git Bash and on Linux, ps on
# macOS). A pid counts as the test's process only by its command line: pids are reused, in Git Bash within minutes.
cmd_of() { if [ -r "/proc/$1/cmdline" ]; then tr '\0' ' ' <"/proc/$1/cmdline" 2>/dev/null; else ps -ww -o command= -p "$1" 2>/dev/null; fi; }
# ours <pid> <text>: <pid> is alive and its command line has <text> (a heartbeat shell carries the block, so $W)
ours() { kill -0 "$1" 2>/dev/null && [[ "$(cmd_of "$1")" == *"$2"* ]]; }
# alive_of <pid file> <duration>: the pids of the file still running `sleep <duration>`
alive_of() {
    local p
    for p in $(cat "$1" 2>/dev/null); do ours "$p" "sleep $2" && printf '%s ' "$p"; done
    return 0
}
none_alive() { [ -z "$(alive_of "$@")" ]; }
gone_pid() { ! kill -0 "$1" 2>/dev/null; }
mtime_of() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"; }   # GNU stat (Git Bash, Linux), else BSD stat (macOS)
# stop_tree <pid>: ends the heartbeat <pid>, as the block's trap does. In Git Bash (the pid has /proc/<pid>/winpid) no
# kill -STOP: there a kill -KILL after it can leave the process alive and deaf to every signal; a heartbeat still
# alive 1 s after kill -KILL is ended through Windows (kill -f).
stop_tree() {
    if [ -e "/proc/$1/winpid" ]; then
        kill -KILL "$1" 2>/dev/null; until_ok 1 gone_pid "$1" || /usr/bin/kill -f -9 "$1" 2>/dev/null
    else
        kill -STOP "$1" 2>/dev/null; pkill -P "$1" 2>/dev/null; kill -KILL "$1" 2>/dev/null; kill -CONT "$1" 2>/dev/null
    fi
    return 0
}
# run_limited <seconds> <out file> <command…>: runs the command in the background, its output to <out file>, and
# waits at most <seconds> for it; sets rc to its exit code, or to "hung" when it was still running then (it is
# stopped with SIGTERM, then SIGKILL). A trap that never returns fails its case instead of hanging the file.
run_limited() {
    local n=$(( $1 * 20 )) out="$2" pid; shift 2
    "$@" >"$out" 2>&1 & pid=$!
    while [ "$n" -gt 0 ] && ! gone_pid "$pid"; do sleep 0.05; n=$((n - 1)); done   # 0.05 s steps: 80 runs, little added
    if gone_pid "$pid"; then wait "$pid"; rc=$?; return 0; fi
    kill "$pid" 2>/dev/null; until_ok 2 gone_pid "$pid" || kill -KILL "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null; rc=hung; return 1
}
FAST=0.2 LONG="300.$$"
# zsh is skipped, with one line, on Windows (Git Bash has none) and on a machine without zsh in PATH. Off Windows
# a skip fails the file below: the zsh cases must not drop out while the file stays green.
SHELLS=(bash zsh) skips=0
skip() { skips=$((skips + 1)); echo "skip $1"; }
if on_windows || ! command -v zsh >/dev/null 2>&1; then
    SHELLS=(bash); skip "zsh: Git Bash on Windows has no zsh (or zsh is not in PATH), the zsh cases run on macOS and Linux"
fi
# The guard of the above: off Windows (by uname, not by on_windows) no skip fired and zsh is in the loop.
case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) ;;
    *) [ "$skips" = 0 ] && [[ " ${SHELLS[*]} " == *" zsh "* ]] && ok "off Windows the zsh cases are not skipped" \
           || bad "off Windows the zsh cases were skipped: $skips skip line(s), shells [${SHELLS[*]}]" ;;
esac
for sh in "${SHELLS[@]}"; do
    W="$T/hb-$sh"; mkdir -p "$W/repo"
    L="$W/e2e.lock"; export HB_PIDS="$W/hb.pids"
    STUB="F() { case \"\$1\" in workflow.e2e_lock) echo '$L' ;; *) return 4 ;; esac; }"
    base="${BE//<N>/5}"; base="${base//<PR worktree>/$W/repo}"; base="${base//<repo>/$W/repo}"
    base="${base//node \"\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/gate.mjs\" full/@GATE@}"
    # A live lock (younger than 30 min) with someone else's holder.json: not removed, the block waits (here: 3 polls,
    # then exit 98) and runs no gate.
    mkdir "$L"; printf '{"prs":[9],"what":"gate-full","pid":1,"since":"x"}\n' >"$L/holder.json"
    b="${base/"$LOCK_POLL"/$LOCK_FAST3}"; b="${b//@GATE@/touch \"$W/ran\"}"
    got="$(PATH="$HBBIN:$PATH" $sh -c "$STUB"$'\n'"$b" 2>&1)"; rc=$?
    [ "$rc" -eq 98 ] && [ ! -e "$W/ran" ] && [ "$(q "$L/holder.json" 's.prs.join(",")' 2>&1)" = 9 ] \
        && ok "$sh: the one-PR gate full block: a live lock with someone else's holder.json stays, the block waits" \
        || bad "$sh: the one-PR block, live lock: exit $rc, gate ran: $([ -e "$W/ran" ] && echo yes || echo no), lock [$(ls -A "$L" 2>&1)] [$got]"
    rm -f "$L/holder.json" "$W/ran"; rmdir "$L" 2>/dev/null
    b0="${base/"$LOCK_POLL"/$LOCK_FAST}"
    # The block's shell killed with kill -9 while the gate runs, then the lock removed: the heartbeat (0.2 s steps
    # here) ends within 3 s. The gate's subshell outlives the shell; it ends when the test creates $W/go.
    b="${b0/"$HB_LOOP"/while \"$HBBIN/hbsleep\" $FAST;}"; b="${b/HB=\$!/HB=\$!; echo \$HB >\"$W/hb.pid\"}"
    gw="\"$HBBIN/waitgo\" \"$W/go\""; b="${b//@GATE@/$gw}"
    PATH="$HBBIN:$PATH" $sh -c "$STUB"$'\n'"$b" >"$W/out" 2>&1 & bp=$!
    if until_ok 10 test -s "$W/hb.pid" && until_ok 10 test -e "$W/go.started"; then
        hb="$(cat "$W/hb.pid")"
        kill -KILL "$bp" 2>/dev/null; wait "$bp" 2>/dev/null
        rm -f "$L/holder.json"; rmdir "$L"
        until_ok 3 gone_pid "$hb" && ok "$sh: the one-PR gate full block: after kill -9 of its shell and the lock removed, the heartbeat ends within 3 s" \
            || bad "$sh: the one-PR block: the heartbeat $hb outlived its shell and the lock"
    else
        kill -KILL "$bp" 2>/dev/null; wait "$bp" 2>/dev/null
        bad "$sh: the one-PR block under kill -9: the lock and the gate were not reached [$(cat "$W/out")]"
    fi
    [ -s "$W/hb.pid" ] && ours "$(cat "$W/hb.pid")" "$W" && stop_tree "$(cat "$W/hb.pid")"
    : >"$W/go"; until_ok 5 test -e "$W/go.done" || bad "$sh: the one-PR block under kill -9: the stub gate did not end"
    rm -f "$L/holder.json" "$W/hb.pid" "$W/go" "$W/go.started" "$W/go.done"; rmdir "$L" 2>/dev/null
    # The same kill -9, but then another agent holds the lock (its own holder.json, an old mtime): the heartbeat that
    # outlived its shell (as one that kill -f also failed to end would) does not touch that lock and ends within 3 s,
    # so the other agent's lock can still go stale. The other holder.json is written first and the old mtime 0.5 s
    # later: a heartbeat step already past its holder.json check when the file changed has touched by then.
    PATH="$HBBIN:$PATH" $sh -c "$STUB"$'\n'"$b" >"$W/out" 2>&1 & bp=$!
    if until_ok 10 test -s "$W/hb.pid" && until_ok 10 test -e "$W/go.started"; then
        hb="$(cat "$W/hb.pid")"
        kill -KILL "$bp" 2>/dev/null; wait "$bp" 2>/dev/null
        printf '{"prs":[9],"what":"gate-full","pid":1,"since":"x"}\n' >"$L/holder.json"; sleep 0.5; touch -t 202001010000 "$L"
        m0="$(mtime_of "$L")"; until_ok 3 gone_pid "$hb"; ended=$?; sleep 0.5; m1="$(mtime_of "$L")"
        [ "$ended" = 0 ] && [ "$m0" = "$m1" ] && [ "$(q "$L/holder.json" 's.prs.join(",")' 2>&1)" = 9 ] \
            && ok "$sh: the one-PR gate full block: a heartbeat that outlived its shell leaves another agent's lock untouched and ends within 3 s" \
            || bad "$sh: the one-PR block: the heartbeat $hb with another agent's lock: ended $([ "$ended" = 0 ] && echo yes || echo no), mtime $m0 -> $m1"
    else
        kill -KILL "$bp" 2>/dev/null; wait "$bp" 2>/dev/null
        bad "$sh: the one-PR block under kill -9, another agent's lock: the lock and the gate were not reached [$(cat "$W/out")]"
    fi
    [ -s "$W/hb.pid" ] && ours "$(cat "$W/hb.pid")" "$W" && stop_tree "$(cat "$W/hb.pid")"
    : >"$W/go"; until_ok 5 test -e "$W/go.done" || bad "$sh: the one-PR block under kill -9, another agent's lock: the stub gate did not end"
    rm -f "$L/holder.json" "$W/hb.pid" "$W/go" "$W/go.started" "$W/go.done"; rmdir "$L" 2>/dev/null
    # The block's shell killed with kill -9 while it holds its own lock, as after a Bash call cut off by its timeout:
    # its holder.json stays and still names the dead shell. The heartbeat ends within 3 s, and the lock, set to an old
    # mtime, is no longer touched: it goes stale, and another agent takes it after 30 min.
    PATH="$HBBIN:$PATH" $sh -c "$STUB"$'\n'"$b" >"$W/out" 2>&1 & bp=$!
    if until_ok 10 test -s "$W/hb.pid" && until_ok 10 test -e "$W/go.started"; then
        hb="$(cat "$W/hb.pid")"
        kill -KILL "$bp" 2>/dev/null; wait "$bp" 2>/dev/null
        until_ok 3 gone_pid "$hb"; ended=$?; touch -t 202001010000 "$L"; m0="$(mtime_of "$L")"; sleep 0.6; m1="$(mtime_of "$L")"
        [ "$ended" = 0 ] && [ "$m0" = "$m1" ] && [ -f "$L/holder.json" ] \
            && ok "$sh: the one-PR gate full block: after kill -9 of its shell its heartbeat ends within 3 s and leaves its own abandoned lock untouched" \
            || bad "$sh: the one-PR block: the heartbeat $hb with its own lock after kill -9: ended $([ "$ended" = 0 ] && echo yes || echo no), mtime $m0 -> $m1"
    else
        kill -KILL "$bp" 2>/dev/null; wait "$bp" 2>/dev/null
        bad "$sh: the one-PR block under kill -9, its own lock: the lock and the gate were not reached [$(cat "$W/out")]"
    fi
    [ -s "$W/hb.pid" ] && ours "$(cat "$W/hb.pid")" "$W" && stop_tree "$(cat "$W/hb.pid")"
    : >"$W/go"; until_ok 5 test -e "$W/go.done" || bad "$sh: the one-PR block under kill -9, its own lock: the stub gate did not end"
    rm -f "$L/holder.json" "$W/hb.pid" "$W/go" "$W/go.started" "$W/go.done"; rmdir "$L" 2>/dev/null
    # A live block. (1) Its heartbeat touches its own lock: the lock, set to an old mtime, gets a new one within 3 s;
    # this needs holder.json written in the very form the heartbeat looks for. (2) Then another agent holds the lock
    # (its holder.json, an old mtime): the heartbeat no longer touches it but does not end while its shell lives, so
    # the trap signals the heartbeat's own pid, not a freed one. (3) The block ends: its trap ends the heartbeat and
    # leaves the other agent's lock in place.
    PATH="$HBBIN:$PATH" $sh -c "$STUB"$'\n'"$b" >"$W/out" 2>&1 & bp=$!
    if until_ok 10 test -s "$W/hb.pid" && until_ok 10 test -e "$W/go.started"; then
        hb="$(cat "$W/hb.pid")"
        touch -t 202001010000 "$L"; old="$(mtime_of "$L")"
        moved() { [ "$(mtime_of "$L")" != "$old" ]; }
        until_ok 3 moved && ok "$sh: the one-PR gate full block: the heartbeat of a live block touches its own lock" \
            || bad "$sh: the one-PR block: the heartbeat $hb did not touch its own lock within 3 s [holder $(cat "$L/holder.json" 2>&1)]"
        printf '{"prs":[9],"what":"gate-full","pid":1,"since":"x"}\n' >"$L/holder.json"; sleep 0.5; touch -t 202001010000 "$L"
        m0="$(mtime_of "$L")"; sleep 1; m1="$(mtime_of "$L")"
        ours "$hb" "$W" && [ "$m0" = "$m1" ] \
            && ok "$sh: the one-PR gate full block: after another agent takes the lock the heartbeat stops touching it but lives while its shell does" \
            || bad "$sh: the one-PR block: another agent's lock under a live block: heartbeat alive $(ours "$hb" "$W" && echo yes || echo no), mtime $m0 -> $m1"
        : >"$W/go"
        if until_ok 10 gone_pid "$bp"; then wait "$bp"; rc=$?; else kill -KILL "$bp" 2>/dev/null; wait "$bp" 2>/dev/null; rc=hung; fi
        [ "$rc" != hung ] && gone_pid "$hb" && [ "$(q "$L/holder.json" 's.prs.join(",")' 2>&1)" = 9 ] \
            && ok "$sh: the one-PR gate full block: its trap ends the heartbeat and leaves another agent's lock in place" \
            || bad "$sh: the one-PR block, another agent's lock at the end: exit $rc, heartbeat gone $(gone_pid "$hb" && echo yes || echo no), lock [$(ls -A "$L" 2>&1)] [$(cat "$W/out")]"
    else
        kill -KILL "$bp" 2>/dev/null; wait "$bp" 2>/dev/null
        bad "$sh: the one-PR block, live: the lock and the gate were not reached [$(cat "$W/out")]"
    fi
    [ -s "$W/hb.pid" ] && ours "$(cat "$W/hb.pid")" "$W" && stop_tree "$(cat "$W/hb.pid")"
    : >"$W/go"; until_ok 5 test -e "$W/go.done" || bad "$sh: the one-PR block, live: the stub gate did not end"
    rm -f "$L/holder.json" "$W/hb.pid" "$W/go" "$W/go.started" "$W/go.done"; rmdir "$L" 2>/dev/null
    for p in $(alive_of "$HB_PIDS" "$FAST"); do kill "$p" 2>/dev/null; done
    # 40 normal runs. Each run has 15 s: a trap that never returns (in Git Bash a heartbeat stopped with kill -STOP and
    # then killed stays alive and deaf to every signal, and `wait` for it hangs) fails the case instead of hanging
    # the file. No run is cut off, every run starts a heartbeat, none of them outlives its run, no heartbeat sleep
    # is left, and no run prints a job notice ("Killed"). Off Windows the gate is an instant `true`, so the trap often
    # fires while the heartbeat is still starting its first sleep; that needs pkill, as the block's trap does. In Git
    # Bash the gate takes 0.3 s, as a real gate takes minutes: the heartbeat is in its sleep when the trap runs. A sleep
    # still starting there may not be visible to the trap yet (see the block's text); and with the old trap 6 runs of
    # 30 of this kind hung, so a trap with kill -STOP fails here almost surely, not by chance.
    if on_windows || command -v pkill >/dev/null 2>&1; then
        if on_windows; then gate_cmd="sleep 0.3"; else gate_cmd=true; fi
        HBS="$W/hb.shells"; : >"$HB_PIDS"; : >"$HBS"
        b="${b0/"$HB_LOOP"/while \"$HBBIN/hbsleep\" $LONG;}"; b="${b//@GATE@/$gate_cmd}"; b="${b/HB=\$!/HB=\$!; echo \$HB >>\"$HBS\"}"
        [[ "$b" == *"hbsleep\" $LONG;"* && "$b" == *"echo \$HB >>\"$HBS\""* && "$b" != *@GATE@* ]] \
            || bad "$sh: the one-PR block: the heartbeat sleep, its pid record or the gate could not be put in the block"
        runs=0 notices=0 hung=0
        for i in $(seq 1 40); do
            run_limited 15 "$W/run.out" env PATH="$HBBIN:$PATH" $sh -c "$STUB"$'\n'"$b" || hung=$((hung + 1))
            got="$(cat "$W/run.out")"; [[ "$got" == *"EXIT=0"* ]] && [ ! -e "$L" ] && runs=$((runs + 1))
            [[ "$got" == *Killed* ]] && notices=$((notices + 1))
            rm -f "$L/holder.json"; rmdir "$L" 2>/dev/null
        done
        until_ok 2 none_alive "$HB_PIDS" "$LONG"; left="$(alive_of "$HB_PIDS" "$LONG")"
        started="$(wc -l <"$HBS" | tr -d ' ')"
        shells=; for p in $(cat "$HBS"); do ours "$p" "$W" && shells="$shells$p "; done
        [ "$runs" = 40 ] && [ "$hung" = 0 ] && [ "$started" = 40 ] && [ "$notices" = 0 ] && [ -z "$shells" ] && [ -z "$left" ] \
            && ok "$sh: the one-PR gate full block: 40 runs (gate: $gate_cmd), each within 15 s, leave no heartbeat shell or sleep and print no job notice" \
            || bad "$sh: the one-PR block (gate: $gate_cmd): $runs of 40 runs green, $hung cut off after 15 s, $started heartbeats started, $notices with a job notice, heartbeat shells left: [$shells], sleeps left: [$left]"
        for p in $shells; do stop_tree "$p"; done
        for p in $left; do kill "$p" 2>/dev/null; done
    else
        echo "skip $sh: no pkill on this machine: the 40-run heartbeat test is not run"
    fi
    unset HB_PIDS
done

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
