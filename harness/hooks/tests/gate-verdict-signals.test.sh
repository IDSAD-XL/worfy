#!/usr/bin/env bash
# Tests of the gate's verdict file when a signal comes (gate-verdict.test.sh has the other paths):
#   - a script ended by a signal is red;
#   - a run that was stopped — a signal to the gate or to its process group while a script
#     runs — writes nothing and removes the file of the run before;
#   - the same while the gate waits for git or for the resolver, or before it starts a script;
#     git that a signal ended without the gate is "could not verify", not an answer; a signal
#     that comes after the verdict is written ends the gate with the code of that verdict.
# Not on Windows: a .cmd file cannot end by a signal, and SIGTERM there kills node without a word;
# gate-verdict-inside.test.sh makes the same moments inside the gate process on every system.
# Run: bash harness/hooks/tests/gate-verdict-signals.test.sh; exit code 0 means everything passed.
# HOOKS_DIR runs the test on another copy of the hooks (for example, on the version before an edit).
set -u
. "$(cd "$(dirname "$0")" && pwd)/gate-verdict-world.sh"

# --- 9b. A script ended by a signal is red; a stopped run writes nothing down ---------------
# A script that a signal ended has failed, whoever sent the signal: exit code 2, the red marker,
# a red verdict. A run is stopped when the gate itself gets the signal while it waits for a
# script: the exit code is 128 + the signal (SIGTERM 143, SIGINT 130), and nothing is written —
# no verdict line, no red marker, no cache entry, and the verdict file of the run before is
# removed. Not on Windows: a .cmd file cannot end by a signal, and SIGTERM there kills node
# without a word.
if [ "$WIN" -eq 1 ]; then echo "skip the signal checks: Windows has no SIGTERM for a .cmd file or for node"; else
    # (a) The script ends by a signal of its own: SIGTERM, and SIGKILL as an out-of-memory kill.
    for how in term kill9; do
        mode ok; touched
        out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
        verdict "before the script ended by a signal ($how): a green file" "$R" '.outcome == "green"'
        mode "$how"; touched
        out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
        verdict "a script ended by a signal ($how) -> outcome red, exit 2" "$R" '.outcome == "red" and .exit == 2 and .key == "t"'
        sig=SIGTERM; [ "$how" = kill9 ] && sig=SIGKILL
        if [ "$rc" -eq 2 ] && [ -s "$STATE/red-t-$(tag "$R")" ] && [[ "$out" == *"[gate] red (fast): t/.:check"* ]] && [[ "$out" == *"ended by the signal $sig"* ]]; then
            ok "a script ended by a signal ($how): exit 2, the red marker, the «red» line, the report names $sig"
        else
            bad "a script ended by a signal ($how): rc=$rc, red marker: $(ls "$STATE" | grep -c '^red-t-'), out: ${out:0:400}"
        fi
    done
    if [[ "$out" == *"said before the kill"* ]]; then ok "a script ended by a signal: what it wrote before the signal is in the report"
    else bad "a script ended by a signal: its output is lost (out: ${out:0:400})"; fi

    # stopped <description> <exit code> <worktree> <key> <cache before>: the run that set $rc and
    # $out ended as a stopped one and left nothing.
    stopped() {
        local d="$1" want="$2" key="$4" before="$5" t
        t="$(tag "$3")"
        if [ "$rc" -eq "$want" ] && [ ! -e "$STATE/red-$key-$t" ] && [ ! -e "$STATE/verdict-$t.json" ] && [ "$(cachesum)" = "$before" ] \
            && [[ "$out" != *"[gate] red"* && "$out" != *"[gate] green"* ]]; then
            ok "$d: exit $want, no verdict line, no red marker, no verdict file, no cache entry"
        else
            bad "$d: rc=$rc (expected $want), red marker: $(ls "$STATE" | grep -c "^red-$key-$t"), verdict: $(head -c 200 "$STATE/verdict-$t.json" 2>/dev/null), cache: $(cachesum) (before: $before), out: ${out:0:300}"
        fi
    }

    # (b) The script sends SIGTERM to the gate and ends well: without the signal the run is green.
    mode ok; touched
    out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    verdict "before the stopped run (the script signals the gate): a green file" "$R" '.outcome == "green"'
    before="$(cachesum)"
    mode termparent; touched
    out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    stopped "stopped run (the script signals the gate)" 143 "$R" t "$before"

    # (c) The signal goes to the process group of the gate, as when a hook runs out of time or
    # Ctrl-C is pressed: the gate and the script get it together. The script ends with code 0 on
    # it (wait0: counted, the run would be green and cached) or with code 1 (wait1: counted, the
    # run would be red). stdin is what a hook gives — a JSON line, then the end — or /dev/null,
    # as the rules tell agents to run the gate.
    # stop_group <TERM | INT> <pipe | null> <worktree>: starts the gate in a process group of its
    # own, waits until the script says it started, sends the signal to the group; sets $rc, $out.
    stop_group() {
        local pid
        rm -f "$T/started" "$T/stop.out"
        # set -m: the job is the leader of a process group of its own (the id of the group is
        # $!), and SIGINT is not ignored in it as it is in a job of a script without job control.
        # exec: the process of the job is the gate itself. With <(…) on stdin, not a pipeline:
        # $! of a pipeline is its last command, but the group is named after the first.
        set -m
        if [ "$2" = pipe ]; then
            (cd "$3" && export GATE_SCOPE=all && exec node "$GATE" fast) < <(printf '%s\n' '{"session_id":"stop"}') >"$T/stop.out" 2>&1 &
        else
            (cd "$3" && export GATE_SCOPE=all && exec node "$GATE" fast) </dev/null >"$T/stop.out" 2>&1 &
        fi
        pid=$!
        set +m
        for _ in $(seq 1 300); do [ -s "$T/started" ] && break; sleep 0.1; done
        if [ -s "$T/started" ]; then kill -s "$1" -- "-$pid"; else kill -s KILL -- "-$pid"; fi
        wait "$pid"; rc=$?
        out="$(cat "$T/stop.out")"
        [ -s "$T/started" ] || out="the script did not start within 30 s; $out"
    }
    for sig in TERM INT; do
        want=143; [ "$sig" = INT ] && want=130
        for how in wait0 wait1; do
            for stdin in pipe null; do
                mode ok; touched
                out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
                verdict "before SIG$sig to the group ($how, stdin: $stdin): a green file" "$R" '.outcome == "green"'
                before="$(cachesum)"
                mode "$how"; touched
                stop_group "$sig" "$stdin" "$R"
                stopped "SIG$sig to the process group while a script runs ($how, stdin: $stdin)" "$want" "$R" t "$before"
            done
        done
    done
    # (d) Two scripts, the signal comes during the first one: the second must not start.
    for sig in TERM INT; do
        want=143; [ "$sig" = INT ] && want=130
        mode ok
        echo "$sig" >"$D/n.txt"
        out="$(cd "$D" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
        verdict "before SIG$sig to the group (two scripts): a green file" "$D" '.outcome == "green"'
        before="$(cachesum)"
        mode wait0
        echo "$sig again" >"$D/n.txt"
        stop_group "$sig" pipe "$D"
        stopped "SIG$sig to the process group during the first of two scripts" "$want" "$D" d "$before"
        if [ "$(cat "$T/started" 2>/dev/null)" = check ]; then ok "SIG$sig during the first of two scripts: the second did not start"
        else bad "SIG$sig during the first of two scripts: started: $(tr '\n' ' ' <"$T/started" 2>/dev/null)"; fi
    done
    mode ok
fi

# --- 9e. A signal while the gate waits for git or the resolver ----------------------------
# The gate also waits for git (the fingerprint of the cache, the list of edits, HEAD for the
# verdict file) and for the resolver, and between them it starts scripts. A signal that comes
# there must stop the run as above: exit 143 or 130 and nothing written — not a green from the
# cache that an empty answer of a killed git made match, not "could not verify", not "nothing
# ran", and no script started. A git of the test is first on PATH and a resolver of the test is
# CLAUDE_GATE_RESOLVE: the call named by $T/slow waits until the test lets it go, so the signal
# lands in that call every time. Not on Windows, as above.
if [ "$WIN" -eq 1 ]; then echo "skip the checks of a signal while the gate waits for git or the resolver: as above"; else
    # hold.pl <pid file> <go file> [command...]: writes its pid, waits for the go file (20 s at
    # most), then becomes the command in the same process (with no command it ends with code 0):
    # a signal to that pid ends the call itself, and no child of it is left behind.
    cat >"$T/hold.pl" <<'EOF'
my ($pidfile, $go, @cmd) = @ARGV;
open(my $f, ">", $pidfile) or die "$pidfile: $!";
print $f "$$\n";
close $f;
for (1 .. 1000) { last if -e $go; select(undef, undef, undef, 0.02) }
exit 0 unless @cmd;
exec { $cmd[0] } @cmd or die "exec $cmd[0]: $!";
EOF
    REALGIT="$(command -v git)"
    mkdir -p "$T/slowgit"
    cat >"$T/slowgit/git" <<EOF
#!/bin/sh
# The git call whose arguments hold the words in $T/slow waits in hold.pl; the others run at once.
w="\$(cat "$T/slow" 2>/dev/null)"
if [ -n "\$w" ]; then
    case " \$* " in *" \$w "*) exec perl "$T/hold.pl" "$T/in-slow" "$T/go" "$REALGIT" "\$@" ;; esac
fi
exec "$REALGIT" "\$@"
EOF
    chmod +x "$T/slowgit/git"
    # The resolver call named by $T/slow ("which" or "plan") waits the same way, then runs on as the
    # real resolver in the same process.
    cat >"$T/slow-resolve.mjs" <<EOF
import fs from "node:fs"
import { pathToFileURL } from "node:url"
let slow = ""
try { slow = fs.readFileSync("$T/slow", "utf8").trim() } catch {}
const which = process.argv[2] === "--which"
fs.appendFileSync("$T/resolver-calls", which ? "which\n" : "plan\n")
if ((slow === "which" && which) || (slow === "plan" && !which)) {
    fs.writeFileSync("$T/in-slow", process.pid + "\n")
    for (let i = 0; i < 1000 && !fs.existsSync("$T/go"); i++) await new Promise((resolve) => setTimeout(resolve, 20))
}
await import(pathToFileURL("$REAL_RESOLVE").href)
EOF
    # A plan resolver that finds no package to check.
    cat >"$T/empty-plan.mjs" <<EOF
import { spawnSync } from "node:child_process"
if (process.argv[2] !== "--which") process.exit(0)
const r = spawnSync(process.execPath, [process.env.REAL_RESOLVE, ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(r.status ?? 1)
EOF

    # The names and the content of every file in the state folder but the verdict files.
    statesum() { (cd "$STATE" && find . -type f ! -name 'verdict-*.json' | LC_ALL=C sort | while IFS= read -r f; do echo "$f"; cat "$f"; done) | cksum; }
    # at <what> <action> <worktree> <node | hook> [VAR=value...]: starts the gate in a process
    # group of its own — `node gate.mjs fast` with stdin from /dev/null, or the hook command
    # `gate.sh fast` with a hook JSON line on stdin — with the git and the resolver of the test.
    # <what> waits: words of a git call, "which" or "plan" for the resolver, "script" for the
    # script of mode hold. Then <action>:
    #   group:SIG       SIG to the process group, as Ctrl-C or a hook that ran out of time;
    #   gate:SIG        SIG to the gate alone, then the call goes on and ends well;
    #   child           SIGTERM to the waiting process alone;
    #   child+gate:SIG  SIGTERM to the waiting process alone, SIG to the gate 0.3 s later: the
    #                   parts of a group signal can come one after another. 0.3 s, not less: the
    #                   gate waits 0.5 s for its own signal after a child ended by one, and with a
    #                   shorter gap a gate that did not wait at all still passed one run in two
    #                   under load.
    # Sets $rc and $out.
    at() {
        local what="$1" action="$2" wt="$3" how="$4" pid child
        shift 4
        rm -f "$T/in-slow" "$T/go" "$T/started"
        echo "$what" >"$T/slow"
        set -m   # see stop_group
        if [ "$how" = hook ]; then
            (cd "$wt" && export CLAUDE_GATE_RESOLVE="$T/slow-resolve.mjs" && { [ $# -eq 0 ] || export "$@"; } && export PATH="$T/slowgit:$PATH" \
                && exec "$HOOKS/gate.sh" fast) < <(printf '%s\n' '{"session_id":"stop","hook_event_name":"TaskCompleted"}') >"$T/stop.out" 2>&1 &
        else
            (cd "$wt" && export CLAUDE_GATE_RESOLVE="$T/slow-resolve.mjs" && { [ $# -eq 0 ] || export "$@"; } && export PATH="$T/slowgit:$PATH" \
                && exec node "$GATE" fast) </dev/null >"$T/stop.out" 2>&1 &
        fi
        pid=$!
        set +m
        for _ in $(seq 1 200); do [ -s "$T/in-slow" ] && break; kill -0 "$pid" 2>/dev/null || break; sleep 0.05; done
        child="$(cat "$T/in-slow" 2>/dev/null)"
        if [ -z "$child" ]; then kill -s KILL -- "-$pid" 2>/dev/null
        else
            case "$action" in
                group:*) kill -s "${action#group:}" -- "-$pid" ;;
                gate:*) kill -s "${action#gate:}" "$pid"; : >"$T/go" ;;
                child) kill -s TERM "$child" ;;
                child+gate:*) kill -s TERM "$child"; sleep 0.3; kill -s "${action#child+gate:}" "$pid" 2>/dev/null ;;
            esac
        fi
        wait "$pid"; rc=$?
        : >"$T/slow"
        out="$(cat "$T/stop.out")"
        [ -n "$child" ] || out="nothing waited in «${what}»; $out"
    }
    # untouched <description> <exit code> <worktree> <state before>: the run that set $rc and $out
    # ended with that code, printed no verdict line, left no verdict file of the worktree and
    # changed nothing else in the state folder: no marker, no cache entry.
    untouched() {
        local t; t="$(tag "$3")"
        if [ "$rc" -eq "$2" ] && [ ! -e "$STATE/verdict-$t.json" ] && [ "$(statesum)" = "$4" ] \
            && [[ "$out" != *"[gate] green"* && "$out" != *"[gate] red"* && "$out" != *"[gate] nothing ran"* && "$out" != *"[gate] not verified"* ]]; then
            ok "$1: exit $2, no verdict line, no verdict file, the state folder as it was"
        else
            bad "$1: rc=$rc (expected $2), verdict: $(head -c 200 "$STATE/verdict-$t.json" 2>/dev/null), state folder changed: $([ "$(statesum)" = "$4" ] && echo no || echo yes), out: ${out:0:300}"
        fi
    }
    # couldnt <description> <worktree> <state before> <text> [nomarker]: the run said «[gate]
    # not verified: <text>» with code 3, no green and no "nothing ran", left no verdict file
    # and wrote nothing but the marker nokey-broken-<tag>-anon with <text>, which stop.mjs reads.
    # With nomarker it wrote no marker either (git ended before the gate knows the worktree). The
    # marker is removed after the check.
    couldnt() {
        local t m marked=yes; t="$(tag "$2")"; m="$STATE/nokey-broken-$t-anon"
        if [ "${5:-}" = nomarker ]; then [ ! -e "$m" ] || marked=no
        else grep -qF "$4" "$m" 2>/dev/null || marked=no; fi
        local marker; marker="$(head -c 200 "$m" 2>/dev/null)"
        rm -f "$m"
        if [ "$rc" -eq 3 ] && [[ "$out" == *"[gate] not verified: $4"* ]] && [[ "$out" != *"[gate] green"* && "$out" != *"[gate] nothing ran"* ]] \
            && [ "$marked" = yes ] && [ ! -e "$STATE/verdict-$t.json" ] && [ "$(statesum)" = "$3" ]; then
            ok "$1: exit 3, «not verified: $4», $([ "${5:-}" = nomarker ] && echo "no marker" || echo "the nokey-broken marker"), nothing else written"
        else
            bad "$1: rc=$rc, marker: ${marker:-none}, verdict: $(head -c 200 "$STATE/verdict-$t.json" 2>/dev/null), state folder changed: $([ "$(statesum)" = "$3" ] && echo no || echo yes), out: ${out:0:300}"
        fi
    }
    started() { # <description> <expected content of $T/started, lines joined by spaces>
        local s; s="$(tr '\n' ' ' 2>/dev/null <"$T/started")"
        if [ "${s% }" = "$2" ]; then ok "$1: started: ${2:-nothing}"; else bad "$1: started: ${s:-nothing} (expected ${2:-nothing})"; fi
    }

    # (a) The cache holds the green of the clean tree at this HEAD; an edit of a tracked file makes
    # the script fail, and without a signal the run is red. A git diff HEAD that a signal ended
    # answers "no edits", and its fingerprint is the one of the clean tree.
    mode ok; touched
    out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    verdict "before a signal in git: a green of the clean tree, cached" "$R" '.outcome == "green"'
    echo '{ "name": "fixture", "scripts": { "check": "true" }, "edited": true }' >"$R/package.json"
    mode logbad
    out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    verdict "before a signal in git: the edit that fails, no signal -> red" "$R" '.outcome == "red" and .exit == 2'
    rm -f "$STATE/nokey-broken-$(tag "$R")-anon"   # left by sections 5 and 6: couldnt below looks for a new one
    before="$(statesum)"
    for sig in TERM INT; do
        want=143; [ "$sig" = INT ] && want=130
        at "diff HEAD --" "group:$sig" "$R" node GATE_SCOPE=all
        untouched "SIG$sig to the group in git diff HEAD of the fingerprint" "$want" "$R" "$before"
        started "SIG$sig to the group in git diff HEAD of the fingerprint" ""
    done
    at "diff HEAD --" group:TERM "$R" hook GATE_SCOPE=all
    untouched "the hook command gate.sh, hook JSON on stdin, SIGTERM to the group in git diff HEAD" 143 "$R" "$before"
    # git ended alone: the gate did not get the signal and has no answer from git.
    at "diff HEAD --" child "$R" node GATE_SCOPE=all
    couldnt "git diff HEAD of the fingerprint ended by a signal the gate did not get" "$R" "$before" "git diff HEAD -- . was ended by the signal SIGTERM"
    at "diff HEAD --" child+gate:TERM "$R" node GATE_SCOPE=all
    untouched "git diff HEAD ended by SIGTERM, the gate's own SIGTERM 0.3 s later" 143 "$R" "$before"
    # The gate alone gets the signal, git answers well: the script must not start.
    at "diff HEAD --" gate:TERM "$R" node GATE_SCOPE=all
    untouched "SIGTERM to the gate alone in git diff HEAD" 143 "$R" "$before"
    started "SIGTERM to the gate alone in git diff HEAD" ""
    # The script ran and failed; the gate gets the signal while it reads HEAD for the verdict file.
    at "rev-parse -q --verify HEAD" gate:TERM "$R" node GATE_SCOPE=all
    untouched "SIGTERM to the gate alone in git rev-parse HEAD of a red verdict" 143 "$R" "$before"
    # git status lists the edits; without GATE_SCOPE no edits means "nothing ran".
    at "status --porcelain" group:TERM "$R" node
    untouched "SIGTERM to the group in git status" 143 "$R" "$before"
    at "status --porcelain" child "$R" node
    couldnt "git status ended by a signal the gate did not get" "$R" "$before" "git status --porcelain --no-renames -z was ended by the signal SIGTERM"
    # The git call that finds the worktree, before the gate has handlers: still not an answer. The
    # gate does not know the worktree yet, so it leaves no marker.
    at "rev-parse --show-toplevel" child "$R" node GATE_SCOPE=all
    couldnt "git rev-parse --show-toplevel ended by a signal the gate did not get" "$R" "$before" "git rev-parse --show-toplevel was ended by the signal SIGTERM" nomarker
    # The second call, the one that finds the repository: the gate knows the worktree by then.
    at "rev-parse --git-common-dir" child "$R" node GATE_SCOPE=all
    couldnt "git rev-parse --git-common-dir ended by a signal the gate did not get" "$R" "$before" "git rev-parse --git-common-dir was ended by the signal SIGTERM"

    # (b) The resolver: the call that names the project (which) and the one that makes the plan.
    for call in which plan; do
        at "$call" group:TERM "$R" node GATE_SCOPE=all
        untouched "SIGTERM to the group while the resolver ($call) runs" 143 "$R" "$before"
        at "$call" child+gate:TERM "$R" node GATE_SCOPE=all
        untouched "the resolver ($call) ended by SIGTERM, the gate's own SIGTERM 0.3 s later" 143 "$R" "$before"
    done
    # The gate gets the signal while it reads HEAD for the verdict of each other ending: the plan
    # resolver crashed, the plan is empty, no edits, not registered.
    at "rev-parse -q --verify HEAD" gate:TERM "$R" node GATE_SCOPE=all CLAUDE_GATE_RESOLVE="$T/plan-crash.mjs" REAL_RESOLVE="$REAL_RESOLVE"
    untouched "SIGTERM to the gate alone in git rev-parse HEAD after the plan resolver crashed" 143 "$R" "$before"
    at "rev-parse -q --verify HEAD" gate:TERM "$R" node GATE_SCOPE=all CLAUDE_GATE_RESOLVE="$T/empty-plan.mjs" REAL_RESOLVE="$REAL_RESOLVE"
    untouched "SIGTERM to the gate alone in git rev-parse HEAD after an empty plan" 143 "$R" "$before"
    at "rev-parse -q --verify HEAD" gate:TERM "$Q" node
    untouched "SIGTERM to the gate alone in git rev-parse HEAD with no edits" 143 "$Q" "$before"
    rm -f "$STATE/nokey-unregistered-$(tag "$U")-anon"
    before="$(statesum)"
    at "rev-parse -q --verify HEAD" gate:TERM "$U" node
    untouched "SIGTERM to the gate alone in git rev-parse HEAD of a project not registered" 143 "$U" "$before"
    # The gate alone gets the signal while the resolver names the project, and the resolver ends
    # well: the gate sees the signal right after it and does not start the resolver of the plan.
    # (With one turn of the event loop in stopIfTold instead of two, the signal waited until the
    # plan resolver had run: the same exit code, but one more child started after the gate was told
    # to stop.)
    rm -f "$T/resolver-calls"
    at which gate:TERM "$R" node GATE_SCOPE=all
    untouched "SIGTERM to the gate alone while the resolver (which) runs" 143 "$R" "$before"
    if [ "$(tr '\n' ' ' <"$T/resolver-calls" 2>/dev/null)" = "which " ]; then ok "SIGTERM to the gate alone while the resolver (which) runs: the plan resolver did not start"
    else bad "SIGTERM to the gate alone while the resolver (which) runs: resolver calls: $(tr '\n' ' ' <"$T/resolver-calls" 2>/dev/null)"; fi
    # The resolver ended alone is the crashed resolver it always was; the line names the signal.
    at which child "$R" node GATE_SCOPE=all
    verdict "the resolver (which) ended by a signal the gate did not get -> outcome unverified, exit 3" "$R" \
        '.outcome == "unverified" and .exit == 3 and .key == null and (.reason | startswith("the registry resolver gate-resolve.mjs was ended by the signal SIGTERM"))'
    if [ "$rc" -eq 3 ] && [[ "$out" == *"[gate] not verified: the registry resolver gate-resolve.mjs was ended by the signal SIGTERM"* ]] && [ -s "$STATE/nokey-broken-$(tag "$R")-anon" ]; then
        ok "the resolver (which) ended alone: exit 3, the line names the signal, the marker of a crashed resolver"
    else bad "the resolver (which) ended alone: rc=$rc, out: ${out:0:300}"; fi
    rm -f "$STATE/nokey-broken-$(tag "$R")-anon"

    # (c) A script ended by a signal alone, the gate's own signal 0.3 s later: stopped, not red.
    mode hold; touched
    before="$(statesum)"
    at script child+gate:TERM "$R" node GATE_SCOPE=all
    untouched "a script ended by SIGTERM, the gate's own SIGTERM 0.3 s later" 143 "$R" "$before"

    # (d) A signal that comes after the verdict is written does not change it: the gate exits with
    # the code of that verdict. The project is not registered, so the gate writes its two lines to
    # stderr — a named pipe that the test fills while the gate reads HEAD and reads only after the
    # signal: the gate is still waiting to write those lines when the signal comes.
    git -C "$R" checkout -q -- package.json
    rm -f "$STATE/verdict-$(tag "$U").json" "$T/err.fifo" "$T/in-slow" "$T/go"
    mkfifo "$T/err.fifo"
    echo "rev-parse -q --verify HEAD" >"$T/slow"
    (cd "$U" && PATH="$T/slowgit:$PATH" exec node "$GATE" fast) </dev/null >"$T/stop.out" 2>"$T/err.fifo" &
    pid=$!
    exec 9<"$T/err.fifo"
    for _ in $(seq 1 200); do [ -s "$T/in-slow" ] && break; sleep 0.05; done
    perl -e 'use Fcntl; sysopen(my $f, $ARGV[0], O_WRONLY | O_NONBLOCK) or die "$ARGV[0]: $!"; 1 while defined syswrite($f, "z" x 4096)' "$T/err.fifo"
    : >"$T/go"
    for _ in $(seq 1 200); do [ -e "$STATE/verdict-$(tag "$U").json" ] && break; sleep 0.05; done
    kill -s TERM "$pid"
    sleep 0.2
    cat <&9 >/dev/null
    exec 9<&-
    wait "$pid"; rc=$?
    : >"$T/slow"
    verdict "SIGTERM after the verdict is written -> the verdict stays: unverified, exit 3" "$U" '.outcome == "unverified" and .exit == 3'
    if [ "$rc" -eq 3 ] && [ -s "$STATE/nokey-unregistered-$(tag "$U")-anon" ]; then ok "SIGTERM after the verdict is written: exit 3, the code of that verdict, and its marker"
    else bad "SIGTERM after the verdict is written: rc=$rc (expected 3), marker: $(ls "$STATE" | grep -c "^nokey-unregistered-$(tag "$U")")"; fi
    rm -f "$T/err.fifo"

    # (e) Two packages: the script of the root runs and passes, then the signal comes in git diff
    # HEAD of packages/a. The cache holds the green of packages/a as committed; an edit of its
    # tracked package.json makes it fail.
    git -C "$K" add packages/a && git -C "$K" -c user.email=t@t -c user.name=t commit -q -m "packages/a"
    mkdir -p "$T/npmlog"
    printf '#!/bin/sh\necho "npm $*" >>"%s/started"\nif grep -q edited packages/a/package.json; then echo "Tests 1 failed"; exit 1; fi\nexit 0\n' "$T" >"$T/npmlog/npm"
    chmod +x "$T/npmlog/npm"
    npmlog="$T/npmlog:$PATH"
    mode logok
    out="$(cd "$K" && PATH="$npmlog" GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    verdict "before a signal in the second package: green, cached" "$K" '.outcome == "green"'
    echo '{ "name": "pkg-a", "scripts": { "check": "true" }, "edited": true }' >"$K/packages/a/package.json"
    out="$(cd "$K" && PATH="$npmlog" GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    verdict "before a signal in the second package: the edit that fails, no signal -> red" "$K" '.outcome == "red" and .exit == 2'
    echo 1 >"$K/n.txt"   # the root changes too: its script runs again
    before="$(statesum)"
    for sig in TERM INT; do
        want=143; [ "$sig" = INT ] && want=130
        at "diff HEAD -- packages/a" "group:$sig" "$K" node GATE_SCOPE=all PATH="$npmlog"
        untouched "two packages: SIG$sig to the group in git diff HEAD of the second, after the first script passed" "$want" "$K" "$before"
        started "two packages: SIG$sig to the group in git diff HEAD of the second" "check"
    done
    at "diff HEAD -- packages/a" gate:TERM "$K" node GATE_SCOPE=all PATH="$npmlog"
    untouched "two packages: SIGTERM to the gate alone in git diff HEAD of the second" 143 "$K" "$before"
    started "two packages: SIGTERM to the gate alone in git diff HEAD of the second" "check"
    git -C "$K" checkout -q -- packages/a/package.json
    mode ok
fi


finish
