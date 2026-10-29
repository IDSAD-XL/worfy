#!/usr/bin/env bash
# Tests of the gate's verdict file at the moments of a signal, made inside the gate process
# (fake.cjs), so that they run on Windows too: a signal right after the verdict file is in place,
# git or a resolver ended by a signal alone or by Node for output past the limit, a signal while
# HEAD is read for the verdict file. Real signals: gate-verdict-signals.test.sh.
# Run: bash harness/hooks/tests/gate-verdict-inside.test.sh; exit code 0 means everything passed.
# HOOKS_DIR runs the test on another copy of the hooks (for example, on the version before an edit).
set -u
. "$(cd "$(dirname "$0")" && pwd)/gate-verdict-world.sh"

# --- 9f. The same moments, made inside the gate: on every system --------------------------
# Windows cannot send node a signal its handler sees, and a child that a signal ended alone, or
# whose output went past the limit, is slow to make for real. fake.cjs, loaded before the gate,
# makes them in the gate process. GATE_FAKE_CALL is a regular expression over the arguments of a
# spawnSync call; GATE_FAKE says what happens to that call:
#   signal        the child is reported ended by SIGTERM, alone (no signal to the gate);
#   enobufs       the child is reported ended by Node for output past maxBuffer (ENOBUFS, SIGTERM);
#   enobufs-pending  the same, and the gate gets SIGTERM when the event loop next goes round;
#   fail          the child is reported to have exited with code 128;
#   emit          the call runs, then the gate gets SIGTERM;
#   after-verdict the gate gets SIGTERM with the first line it prints after its verdict file is
#                 in place.
# GATE_FAKE_EMIT_ON and GATE_FAKE_WAITS are described in the file below.
# The handler of the gate runs at once, where a real signal waits until the event loop looks for
# events: so the checks also hold for code that would wait where the gate does not wait today.
cat >"$T/fake.cjs" <<'EOF'
const child = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
if (/gate\.mjs$/.test(process.argv[1] || "")) {
    const what = process.env.GATE_FAKE
    const call = new RegExp(process.env.GATE_FAKE_CALL || "^$")
    const realSpawnSync = child.spawnSync
    child.spawnSync = (file, args = [], options) => {
        if (!call.test(args.join(" "))) return realSpawnSync(file, args, options)
        if (what === "signal") return { pid: 0, output: [null, "", ""], stdout: "", stderr: "", status: null, signal: "SIGTERM" }
        if (what === "enobufs" || what === "enobufs-pending") {
            // enobufs-pending: the gate was also told to stop while it waited; that signal is
            // delivered when the event loop next goes round, as a real one is.
            if (what === "enobufs-pending") setImmediate(() => process.emit("SIGTERM"))
            const error = Object.assign(new Error("spawnSync ENOBUFS"), { code: "ENOBUFS" })
            return { pid: 0, output: [null, "x", ""], stdout: "x", stderr: "", status: null, signal: "SIGTERM", error }
        }
        if (what === "fail") return { pid: 0, output: [null, "", ""], stdout: "", stderr: "", status: 128, signal: null }
        const run = realSpawnSync(file, args, options)
        if (what === "emit") process.emit("SIGTERM")
        return run
    }
    // The gate counts the file as written once the rename has returned; the signal comes with the
    // first line the gate prints after that, its verdict line or the reason.
    let renamed = false
    const realRename = fs.renameSync
    fs.renameSync = (from, to) => {
        realRename(from, to)
        if (/^verdict-/.test(path.basename(String(to)))) renamed = true
    }
    // GATE_FAKE_EMIT_ON: SIGTERM comes, once, with the first line the gate prints that matches
    // this regular expression (whatever GATE_FAKE is).
    let emitOn = process.env.GATE_FAKE_EMIT_ON ? new RegExp(process.env.GATE_FAKE_EMIT_ON) : null
    for (const stream of [process.stdout, process.stderr]) {
        const realWrite = stream.write.bind(stream)
        stream.write = (...args) => {
            if (what === "after-verdict" && renamed) {
                renamed = false
                process.emit("SIGTERM")
            }
            if (emitOn && emitOn.test(String(args[0]))) {
                emitOn = null
                process.emit("SIGTERM")
            }
            return realWrite(...args)
        }
    }
    // GATE_FAKE_WAITS: a file that gets one line for each wait of STOP_WAIT_MS (500 ms) the gate
    // starts — the wait for its own signal after a child that a signal ended.
    if (process.env.GATE_FAKE_WAITS) {
        const realSetTimeout = globalThis.setTimeout
        globalThis.setTimeout = (fn, ms, ...rest) => {
            if (ms === 500) fs.appendFileSync(process.env.GATE_FAKE_WAITS, "500\n")
            return realSetTimeout(fn, ms, ...rest)
        }
    }
    require("node:module").syncBuiltinESMExports()
}
EOF
# fake <worktree> <GATE_FAKE> <GATE_FAKE_CALL> [VAR=value...]: runs `node gate.mjs fast` with
# fake.cjs and stdin from /dev/null; sets $rc and $out.
fake() {
    local wt="$1" what="$2" call="$3"; shift 3
    out="$(cd "$wt" && env GATE_FAKE="$what" GATE_FAKE_CALL="$call" NODE_OPTIONS="--require \"$T/fake.cjs\"" "$@" node "$GATE" fast </dev/null 2>&1)"; rc=$?
}
# The waits of 0.5 s that $T/waits recorded (GATE_FAKE_WAITS).
waitcount() { if [ -f "$T/waits" ]; then grep -c . "$T/waits"; else echo 0; fi; }
VR="$STATE/verdict-$(tag "$R").json"
MR="$STATE/nokey-broken-$(tag "$R")-anon"
# (a) A signal right after the verdict file is in place: the gate exits with the code of that
# verdict, whatever the gate does between writing it and returning.
mode bad; touched
fake "$R" after-verdict "" GATE_SCOPE=all
verdict "SIGTERM right after a red verdict file is in place -> the file stays: red, exit 2" "$R" '.outcome == "red" and .exit == 2'
if [ "$rc" -eq 2 ]; then ok "SIGTERM right after a red verdict file is in place: exit 2, the code of that verdict"
else bad "SIGTERM right after a red verdict file is in place: rc=$rc (expected 2), out: ${out:0:300}"; fi
mode ok
fake "$U" after-verdict ""
verdict "SIGTERM right after an unverified verdict file is in place -> the file stays: unverified, exit 3" "$U" '.outcome == "unverified" and .exit == 3'
if [ "$rc" -eq 3 ]; then ok "SIGTERM right after an unverified verdict file is in place: exit 3, the code of that verdict"
else bad "SIGTERM right after an unverified verdict file is in place: rc=$rc (expected 3), out: ${out:0:300}"; fi
# The same for each other place that writes an outcome: the plan resolver crashed (3), green (0),
# no changes (0), an empty plan (0).
cat >"$T/no-plan.mjs" <<EOF
import { spawnSync } from "node:child_process"
if (process.argv[2] !== "--which") process.exit(0)
const r = spawnSync(process.execPath, [process.env.REAL_RESOLVE, ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(r.status ?? 1)
EOF
# after <description> <worktree> <outcome> <exit> [VAR=value...]
after() {
    local d="$1" wt="$2" outcome="$3" want="$4"; shift 4
    fake "$wt" after-verdict "" "$@"
    verdict "SIGTERM right after the verdict file is in place ($d) -> the file stays: $outcome, exit $want" "$wt" '.outcome == $o and .exit == ($e | tonumber)' --arg o "$outcome" --arg e "$want"
    if [ "$rc" -eq "$want" ]; then ok "SIGTERM right after the verdict file is in place ($d): exit $want"
    else bad "SIGTERM right after the verdict file is in place ($d): rc=$rc (expected $want), out: ${out:0:300}"; fi
}
touched
after "the plan resolver crashed" "$R" unverified 3 GATE_SCOPE=all CLAUDE_GATE_RESOLVE="$T/plan-crash.mjs" REAL_RESOLVE="$REAL_RESOLVE"
touched
after "green" "$R" green 0 GATE_SCOPE=all
after "no changes" "$Q" none 0
touched
after "an empty plan" "$R" none 0 GATE_SCOPE=all CLAUDE_GATE_RESOLVE="$T/no-plan.mjs" REAL_RESOLVE="$REAL_RESOLVE"
# (b) git that finds the repository, ended alone: the gate knows the worktree by then, so the
# verdict file of the run before goes and the marker is left.
touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "before git rev-parse --git-common-dir ends alone: a green file" "$R" '.outcome == "green"'
fake "$R" signal "rev-parse --git-common-dir" GATE_SCOPE=all
if [ "$rc" -eq 3 ] && [[ "$out" == *"[gate] not verified: git rev-parse --git-common-dir was ended by the signal SIGTERM"* ]] && [ ! -e "$VR" ]; then
    ok "git rev-parse --git-common-dir ended alone: exit 3, the line, the green file of the run before is removed"
else bad "git rev-parse --git-common-dir ended alone: rc=$rc, verdict: $(head -c 200 "$VR" 2>/dev/null), out: ${out:0:300}"; fi
if grep -qF "git rev-parse --git-common-dir was ended by the signal SIGTERM. The gate itself failed" "$MR" 2>/dev/null; then ok "git rev-parse --git-common-dir ended alone: the nokey-broken marker"
else bad "git rev-parse --git-common-dir ended alone: marker: $(head -c 200 "$MR" 2>/dev/null)"; fi
rm -f "$MR"
# (c) The first git, the one that finds the worktree: before it answers the gate knows neither the
# verdict file nor the tag, so both stay as they are (the header of gate.mjs says so).
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
fake "$R" signal "rev-parse --show-toplevel" GATE_SCOPE=all
if [ "$rc" -eq 3 ] && [[ "$out" == *"[gate] not verified: git rev-parse --show-toplevel was ended by the signal SIGTERM"* ]] && [ -e "$VR" ] && [ ! -e "$MR" ]; then
    ok "git rev-parse --show-toplevel ended alone: exit 3, the line; the verdict file of the run before stays, no marker"
else bad "git rev-parse --show-toplevel ended alone: rc=$rc, verdict file: $([ -e "$VR" ] && echo there || echo gone), marker: $([ -e "$MR" ] && echo there || echo none), out: ${out:0:300}"; fi
# (d) git whose output went past the limit: Node ended it, no signal came from outside.
touched
fake "$R" enobufs "status --porcelain" GATE_SCOPE=all
if [ "$rc" -eq 3 ] && [[ "$out" == *"[gate] not verified: git status --porcelain --no-renames -z wrote more output than the gate reads, and Node ended it"* ]] \
    && [[ "$out" != *"was ended by the signal"* ]] && [ ! -e "$VR" ] && [ -s "$MR" ]; then
    ok "git with output past the limit: exit 3, the line says so and names no signal, no verdict file, the marker"
else bad "git with output past the limit: rc=$rc, out: ${out:0:300}"; fi
rm -f "$MR"
# The same git, and the gate was told to stop while it waited: the run is stopped — 143, no marker,
# no "could not verify" line.
touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
fake "$R" enobufs-pending "status --porcelain" GATE_SCOPE=all
if [ "$rc" -eq 143 ] && [ ! -e "$MR" ] && [ ! -e "$VR" ] && [[ "$out" != *"[gate] not verified"* ]]; then
    ok "git past the output limit while the gate was told to stop: exit 143, no marker, no verdict file, no line"
else bad "git past the output limit while the gate was told to stop: rc=$rc (expected 143), marker: $([ -e "$MR" ] && echo there || echo none), out: ${out:0:300}"; fi
rm -f "$MR"
# A signal after the error is written down (with its second line) does not change it: 3.
fake "$R" enobufs "status --porcelain" GATE_SCOPE=all GATE_FAKE_EMIT_ON="The gate itself failed"
if [ "$rc" -eq 3 ] && [ -s "$MR" ]; then ok "SIGTERM after an error of the gate is written down: exit 3, the marker stays"
else bad "SIGTERM after an error of the gate is written down: rc=$rc (expected 3), marker: $([ -e "$MR" ] && echo there || echo none), out: ${out:0:300}"; fi
rm -f "$MR"
# git that finds the repository fails without a signal (exit 128): the gate takes the folder for
# one outside git — exit 0, no line — and removes the verdict file of the run before.
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "before git rev-parse --git-common-dir fails: a green file" "$R" '.outcome == "green"'
fake "$R" fail "rev-parse --git-common-dir" GATE_SCOPE=all
if [ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -e "$VR" ] && [ ! -e "$MR" ]; then ok "git rev-parse --git-common-dir exits 128: exit 0, no output, the verdict file of the run before is removed"
else bad "git rev-parse --git-common-dir exits 128: rc=$rc, verdict file: $([ -e "$VR" ] && echo there || echo gone), out: ${out:0:300}"; fi
# (e) The resolvers ended by a signal alone or past the output limit: the line says what ended them.
rm -f "$T/waits"
fake "$R" signal "--which" GATE_SCOPE=all GATE_FAKE_WAITS="$T/waits"
if [ "$(waitcount)" = 1 ]; then ok "the resolver (which) ended by a signal alone: the gate waits 0.5 s once for its own signal"
else bad "the resolver (which) ended by a signal alone: waits of 0.5 s: $(waitcount)"; fi
verdict "the resolver (which) ended by a signal alone -> unverified, the reason names the signal" "$R" \
    '.outcome == "unverified" and .exit == 3 and .key == null and .reason == "the registry resolver gate-resolve.mjs was ended by the signal SIGTERM"'
if [ "$rc" -eq 3 ] && [[ "$out" == *"[gate] not verified: the registry resolver gate-resolve.mjs was ended by the signal SIGTERM"* ]] && [ -s "$MR" ]; then
    ok "the resolver (which) ended by a signal alone: exit 3, the line names the signal, the marker"
else bad "the resolver (which) ended by a signal alone: rc=$rc, out: ${out:0:300}"; fi
rm -f "$MR"
rm -f "$T/waits"
fake "$R" enobufs "--which" GATE_SCOPE=all GATE_FAKE_WAITS="$T/waits"
if [ "$rc" -eq 3 ] && [[ "$out" == *"[gate] not verified: the registry resolver gate-resolve.mjs wrote more output than the gate reads"* ]]; then
    ok "the resolver (which) past the output limit: exit 3, the line says so"
else bad "the resolver (which) past the output limit: rc=$rc, out: ${out:0:300}"; fi
# The reason is exactly that: not the "spawnSync ENOBUFS" of Node's error. And no signal came from
# outside, so the gate does not wait half a second for one.
verdict "the resolver (which) past the output limit -> the reason says so and nothing more" "$R" \
    '.reason == "the registry resolver gate-resolve.mjs wrote more output than the gate reads, and Node ended it"'
if [ "$(waitcount)" = 0 ]; then ok "the resolver (which) past the output limit: no 0.5 s wait for a signal"
else bad "the resolver (which) past the output limit: waits of 0.5 s: $(waitcount)"; fi
rm -f "$MR"
UR="$STATE/unverified-t-$(tag "$R")"
for how in signal enobufs; do
    words="was ended by the signal SIGTERM"; [ "$how" = enobufs ] && words="wrote more output than the gate reads, and Node ended it"
    touched
    rm -f "$T/waits"
    fake "$R" "$how" "gate-resolve\.mjs (?!--which)" GATE_SCOPE=all GATE_FAKE_WAITS="$T/waits"
    waits=0; [ "$how" = signal ] && waits=1
    if [ "$(waitcount)" = "$waits" ]; then ok "the plan resolver ($how): $waits wait(s) of 0.5 s for the gate's own signal"
    else bad "the plan resolver ($how): waits of 0.5 s: $(waitcount) (expected $waits)"; fi
    verdict "the plan resolver ($how) -> unverified, exit 3, the reason says what ended it" "$R" \
        '.outcome == "unverified" and .exit == 3 and .key == "t" and .reason == "the plan resolver gate-resolve.mjs " + $w' --arg w "$words"
    if [ "$rc" -eq 3 ] && [[ "$out" == *"[gate] not verified: the plan resolver gate-resolve.mjs $words — "* ]] && grep -qF "Could not verify: the plan resolver $words." "$UR" 2>/dev/null; then
        ok "the plan resolver ($how): exit 3, the line and the unverified marker say what ended it"
    else bad "the plan resolver ($how): rc=$rc, marker: $(head -c 200 "$UR" 2>/dev/null), out: ${out:0:300}"; fi
done
rm -f "$UR"
# (f) Two packages: the root passes, packages/a fails, and the gate gets SIGTERM while it reads
# HEAD for the verdict file. The run is stopped: no verdict file, and the cache is as it was —
# the new green of the root is written only with the outcome.
echo 2 >"$K/n.txt"
before="$(cachesum)"
fake "$K" emit "rev-parse -q --verify HEAD" GATE_SCOPE=all PATH="$npmbad"
if [ "$rc" -eq 143 ] && [ ! -e "$STATE/verdict-$(tag "$K").json" ] && [ "$(cachesum)" = "$before" ] && [[ "$out" == *"[gate] scope"* ]]; then
    ok "two packages, SIGTERM while HEAD is read for the verdict: exit 143, no verdict file, no new cache entry"
else bad "two packages, SIGTERM while HEAD is read for the verdict: rc=$rc (expected 143), cache changed: $([ "$(cachesum)" = "$before" ] && echo no || echo yes), out: ${out:0:300}"; fi
rm -f "$K/n.txt"

finish
