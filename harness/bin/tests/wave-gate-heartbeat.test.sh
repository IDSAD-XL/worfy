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
# alive_of <pid file> <duration>: the pids of the file still running `sleep <duration>` (ps without -o: any live pid;
# the ps of Git Bash on Windows has no -o, so there every live pid of the file counts)
alive_of() {
    local p cmd
    for p in $(cat "$1" 2>/dev/null); do
        kill -0 "$p" 2>/dev/null || continue
        cmd="$(ps -o command= -p "$p" 2>/dev/null)" || cmd="sleep $2"
        case "$cmd" in *"sleep $2"*) printf '%s ' "$p" ;; esac
    done
    return 0
}
none_alive() { [ -z "$(alive_of "$@")" ]; }
gone_pid() { ! kill -0 "$1" 2>/dev/null; }
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
    [ -s "$W/hb.pid" ] && stop_tree "$(cat "$W/hb.pid")"
    : >"$W/go"; until_ok 5 test -e "$W/go.done" || bad "$sh: the one-PR block under kill -9: the stub gate did not end"
    rm -f "$L/holder.json"; rmdir "$L" 2>/dev/null
    for p in $(alive_of "$HB_PIDS" "$FAST"); do kill "$p" 2>/dev/null; done
    # 40 normal runs, the gate an instant `true`, so the trap often fires while the heartbeat is still starting its
    # first sleep. Each run has 15 s: a trap that never returns (in Git Bash a heartbeat stopped with kill -STOP and
    # then killed stays alive and deaf to every signal, and `wait` for it hangs) fails the case instead of hanging
    # the file. No run is cut off, no heartbeat shell outlives its run, and no run prints a job notice ("Killed").
    # Off Windows no heartbeat sleep is left either; that needs pkill, as the block's trap does. In Git Bash a sleep
    # the trap catches while it is still starting can miss its signal and run on, its output on /dev/null; the test
    # ends it below.
    if on_windows || command -v pkill >/dev/null 2>&1; then
        HBS="$W/hb.shells"; : >"$HB_PIDS"; : >"$HBS"
        b="${b0/"$HB_LOOP"/while \"$HBBIN/hbsleep\" $LONG;}"; b="${b//@GATE@/true}"; b="${b/HB=\$!/HB=\$!; echo \$HB >>\"$HBS\"}"
        runs=0 notices=0 hung=0
        for i in $(seq 1 40); do
            run_limited 15 "$W/run.out" env PATH="$HBBIN:$PATH" $sh -c "$STUB"$'\n'"$b" || hung=$((hung + 1))
            got="$(cat "$W/run.out")"; [[ "$got" == *"EXIT=0"* ]] && [ ! -e "$L" ] && runs=$((runs + 1))
            [[ "$got" == *Killed* ]] && notices=$((notices + 1))
            rm -f "$L/holder.json"; rmdir "$L" 2>/dev/null
        done
        until_ok 2 none_alive "$HB_PIDS" "$LONG"; left="$(alive_of "$HB_PIDS" "$LONG")"
        shells=; for p in $(cat "$HBS"); do kill -0 "$p" 2>/dev/null && shells="$shells$p "; done
        if on_windows; then sleeps="" what="no heartbeat shell"; else sleeps="$left" what="no heartbeat shell or sleep"; fi
        [ "$runs" = 40 ] && [ "$hung" = 0 ] && [ "$notices" = 0 ] && [ -z "$shells" ] && [ -z "$sleeps" ] \
            && ok "$sh: the one-PR gate full block: 40 runs, each within 15 s, leave $what and print no job notice" \
            || bad "$sh: the one-PR block: $runs of 40 runs green, $hung cut off after 15 s, $notices with a job notice, heartbeat shells left: [$shells], sleeps left: [$sleeps]"
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
