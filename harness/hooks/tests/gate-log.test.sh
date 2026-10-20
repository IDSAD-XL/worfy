#!/usr/bin/env bash
# Tests of the gate's output logs: gate.mjs writes the whole output of every script it runs to a
# file under <state>/logs/<worktree tag>/<run>/, keeps the newest runs of each worktree, and the
# report of a failed script names that file next to the last 40 lines. For output shaped like the
# Playwright list reporter the report also carries the failure blocks that lie above the last 40
# lines, within a size limit.
#   - a failing script that writes 500 lines: the tail and the log path in the report, all 500
#     lines in the file;
#   - a script that passed in the same run leaves its log too;
#   - Playwright-shaped output with the error at line 300 of 500: the error lines in the report;
#     the same "Error:" line in output of another shape is not picked out; a long block is cut;
#   - old runs of the worktree are pruned, logs of other worktrees untouched for long are removed.
# Run: bash harness/hooks/tests/gate-log.test.sh; exit code 0 means everything passed.
# HOOKS_DIR runs the test on another copy of the hooks (for example, on the version before an edit).
#
# HOME, HARNESS_HOME, the registry and the repository are temporary: the test does not touch the
# live registry, state folder or markers.
set -u
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
HOOKS="${HOOKS_DIR:-$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })}"
GATE="$HOOKS/gate.mjs"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
unset CLAUDE_CODE_SESSION_ID GATE_SCOPE CLAUDE_GATE_STATE EVAL_HARNESS_HOME
T="$(mktemp -d)" || exit 1
[ -d "$T" ] || exit 1
T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
tag() { node -e 'process.stdout.write(require("node:crypto").createHash("sha1").update(process.argv[1]).digest("hex").slice(0, 8))' "$1"; }
unixpath() { if [ "$WIN" -eq 1 ]; then cygpath -u "$1"; else printf '%s' "$1"; fi; }

export HOME="$T/home" USERPROFILE="$T/home" HARNESS_HOME="$T/harness"
export CLAUDE_GATE_CONFIG="$T/config.json"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
mkdir -p "$HOME" "$HARNESS_HOME"
LOGS="$HARNESS_HOME/gate/state/logs"

# --- fixtures ---------------------------------------------------------------------
# The gate runs "<pm> run <script>". The package manager here is fakepm.cjs (through a .cmd on
# Windows, where node starts nothing else without an interpreter): the script "lint" always passes
# with 30 lines; what "check" writes is set by $T/mode.
cat >"$T/fakepm.cjs" <<'EOF'
const fs = require("node:fs")
const path = require("node:path")
const script = process.argv[3]
const mode = fs.readFileSync(path.join(__dirname, "mode"), "utf8").trim()
const out = []
const pad = (to, make) => { while (out.length < to) out.push(make(out.length + 1)) }
let code = 1
if (script === "lint") {
    pad(30, (n) => `lint line ${n}`)
    code = 0
} else if (mode === "ok") {
    out.push("check passed")
    code = 0
} else if (mode === "long") {
    pad(500, (n) => `output line ${n}`)
} else if (mode === "playwright") {
    // The list reporter: one line per test, then the failure blocks, then the summary.
    pad(297, (n) => `  ok ${n} tests/a.spec.ts:${n}:1 › passes ${n} (10ms)`)
    out.push("  1) tests/a.spec.ts:20:3 › suite › first ──────────────────", "")
    out.push("    Error: expect(locator).toBeVisible() failed", "", "    Locator: getByTestId('x')", "    Expected: visible")
    out.push("    Call log:", "      - waiting for getByTestId('x')", "", "        at /repo/tests/a.spec.ts:24:5", "")
    out.push("  2) tests/b.spec.ts:5:1 › other ─────────────────────────────", "")
    out.push("    TimeoutError: second failure marker", "", "        at /repo/tests/b.spec.ts:9:3", "")
    out.push("  2 failed", "    tests/a.spec.ts:20:3 › suite › first", "    tests/b.spec.ts:5:1 › other", "  295 passed (2.0m)")
    pad(500, (n) => `  reporter note ${n}`)
} else if (mode === "plain") {
    pad(299, (n) => `plain line ${n}`)
    out.push("Error: plain marker")
    pad(500, (n) => `plain line ${n}`)
} else if (mode === "caps") {
    // Four blocks of 60 lines each (240 lines, over the limit of 200 in all), one line of 600 characters.
    pad(10, (n) => `  ok ${n} tests/a.spec.ts:${n}:1 › passes ${n} (10ms)`)
    for (let b = 1; b <= 4; b++) {
        out.push(`  ${b}) tests/caps.spec.ts:${b}:1 › block ${b} ───────`, `    Error: caps block ${b}`)
        if (b === 1) out.push("y".repeat(600))
        const top = out.length + (b === 1 ? 57 : 58)
        pad(top, (n) => `      - call log ${b}.${n}`)
    }
    out.push("  4 failed")
    pad(500, (n) => `  reporter note ${n}`)
} else if (mode === "huge-block") {
    pad(10, (n) => `  ok ${n} tests/a.spec.ts:${n}:1 › passes ${n} (10ms)`)
    out.push("  1) tests/big.spec.ts:3:1 › big ───────", "", "    Error: big block marker")
    pad(440, (n) => `      - call log ${n}`)
    out.push("  1 failed", "    tests/big.spec.ts:3:1 › big")
    pad(500, (n) => `  reporter note ${n}`)
}
process.stdout.write(out.join("\n") + "\n")
process.exit(code)
EOF
if [ "$WIN" -eq 1 ]; then
    PM="$T/fakepm.cmd"
    printf '@echo off\r\nnode "%%~dp0fakepm.cjs" %%*\r\n' >"$PM"
else
    PM="$T/fakepm"
    printf '#!/bin/sh\nexec node "%s/fakepm.cjs" "$@"\n' "$T" >"$PM"
    chmod +x "$PM"
fi
mode() { echo "$1" >"$T/mode"; }

R="$T/repo"
mkdir -p "$R"
git -C "$R" init -q -b main
echo '{ "name": "fixture", "scripts": { "lint": "true", "check": "true" } }' >"$R/package.json"
git -C "$R" add package.json
git -C "$R" commit -q -m init
git -C "$R" update-ref refs/remotes/origin/main HEAD
jq -n --arg r "$R" --arg pm "$PM" '{repos: [{key: "t", match: $r, pm: $pm, root: {fast: ["lint", "check"]}, workspace: {}}]}' >"$CLAUDE_GATE_CONFIG"
RT="$(git -C "$R" rev-parse --show-toplevel)"
TAG="$(tag "$RT")"
n=0
touched() { n=$((n + 1)); echo "$n" >"$R/n.txt"; }   # changes the content, so the green cache misses
# The age of files and folders, in days: their modification time set that far back.
age() { node -e 'const t = Date.now() / 1000 - Number(process.argv[1]) * 86400; for (const p of process.argv.slice(2)) require("node:fs").utimesSync(p, t, t)' "$@"; }
# The run folders of this worktree, one name a line; newruns prints the ones that appeared since $before.
runs() { ls "$LOGS/$TAG" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' | LC_ALL=C sort; }
newruns() { comm -13 <(printf '%s\n' "$before") <(runs); }
run() { before="$(runs)"; touched; out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?; }
# The path of the "check" log as the report names it.
logpath() { printf '%s\n' "$out" | sed -n 's/^--- full output ([0-9]* lines): //p' | head -1 | tr -d '\r'; }

# --- 1. A failing script of 500 lines: the tail and the log path ----------------------
mode long; run
if [ "$rc" -eq 2 ] && [[ "$out" == *$'\n'"output line 461"$'\n'* ]] && [[ "$out" == *"output line 500"* ]] && [[ "$out" != *"output line 460"$'\n'* ]]; then
    ok "red run: the report keeps the last 40 lines"
else bad "red run: tail of 40 lines expected (rc=$rc, out: ${out:0:400})"; fi
L="$(logpath)"
if [ -n "$L" ]; then ok "red run: the report names the log file ($L)"; else bad "red run: no '--- full output (N lines): <path>' line in the report (out: ${out: -600})"; fi
LU="$(unixpath "$L")"
if [ -n "$L" ] && [ -f "$LU" ] && [ "$(wc -l <"$LU" | tr -d ' ')" -eq 500 ] && grep -qx "output line 1" "$LU" && grep -qx "output line 500" "$LU"; then
    ok "red run: the log file holds all 500 lines"
else bad "red run: log file with 500 lines expected at '$L'"; fi
case "$LU" in "$(unixpath "$LOGS")/$TAG/"*) ok "red run: the log lies under \$HARNESS_HOME/gate/state/logs/<worktree tag>/" ;;
    *) bad "red run: the log is not under $LOGS/$TAG/: '$L'" ;; esac
if [[ "$out" == *"--- full output (500 lines): "* ]]; then ok "red run: the report counts the lines of the log"; else bad "red run: line count expected"; fi

# --- 2. A script that passed leaves a log too ------------------------------------------
RUN="$(dirname "$LU")"
LINT="$(ls "$RUN" 2>/dev/null | grep 'lint' | head -1)"
if [ -n "$LINT" ] && [ "$(wc -l <"$RUN/$LINT" | tr -d ' ')" -eq 30 ] && grep -qx "lint line 30" "$RUN/$LINT"; then
    ok "the script that passed in the red run has its log in the same run folder"
else bad "no log of the passed script lint in $RUN ($(ls "$RUN" 2>/dev/null | tr '\n' ' '))"; fi
mode ok; run
NEWEST="$(newruns)"
NEWDIR="$(unixpath "$LOGS")/$TAG/$NEWEST"
if [ "$rc" -eq 0 ] && [ "$(jq -r .outcome "$HARNESS_HOME/gate/state/verdict-$TAG.json" | tr -d "\r")" = green ] && [ "$(printf '%s\n' "$NEWEST" | grep -c .)" -eq 1 ] && [ "$NEWDIR" != "$RUN" ] \
    && grep -qx "check passed" "$NEWDIR/"*check*.log 2>/dev/null && grep -qx "lint line 1" "$NEWDIR/"*lint*.log 2>/dev/null; then
    ok "green run: every script leaves its log in a new run folder"
else bad "green run: logs expected in a new run folder (rc=$rc, new: $NEWEST, files: $(ls "$NEWDIR" 2>/dev/null | tr '\n' ' '), out: ${out:0:300})"; fi
if [[ "$out" != *"--- full output"* ]]; then ok "green run: the report has no log lines"; else bad "green run printed a log line: ${out:0:300}"; fi

# --- 3. Playwright-shaped output: the failure blocks above the tail ------------------
mode playwright; run
if [ "$rc" -eq 2 ] && [[ "$out" == *"Error: expect(locator).toBeVisible() failed"* ]] && [[ "$out" == *"1) tests/a.spec.ts:20:3 › suite › first"* ]] \
    && [[ "$out" == *"Locator: getByTestId('x')"* ]] && [[ "$out" == *"TimeoutError: second failure marker"* ]]; then
    ok "Playwright output: the error lines at line 300 of 500 are in the report"
else bad "Playwright output: error lines expected in the report (rc=$rc, out: ${out:0:1200})"; fi
if [[ "$out" == *"--- Playwright failures above the last 40 lines"* ]] && [[ "$out" != *"passes 296 (10ms)"* ]]; then
    ok "Playwright output: the blocks come under their own heading, without the passed tests"
else bad "Playwright output: heading expected, passed tests not (out: ${out:0:1200})"; fi
mode plain; run
if [ "$rc" -eq 2 ] && [[ "$out" != *"plain marker"* ]] && [[ "$out" != *"--- Playwright failures"* ]]; then
    ok "output of another shape: an 'Error:' line above the tail is not picked out"
else bad "output of another shape: no Playwright section expected (rc=$rc, out: ${out:0:600})"; fi
mode huge-block; run
section="$(printf '%s\n' "$out" | sed -n '/^--- Playwright failures/,/^--- full output/p')"
count="$(printf '%s\n' "$section" | wc -l | tr -d ' ')"
if [[ "$section" == *"Error: big block marker"* ]] && [ "$count" -le 70 ] && [[ "$section" == *"more lines in the full output"* ]]; then
    ok "a long Playwright block is cut to the limit ($count lines with the headings)"
else bad "a long block: cut expected (lines: $count, section: ${section:0:400})"; fi
mode caps; run
body="$(printf '%s\n' "$out" | sed -n '/^--- Playwright failures/,/^--- full output/p' | sed '1d;$d')"
count="$(printf '%s\n' "$body" | wc -l | tr -d ' ')"
Y500="$(printf 'y%.0s' $(seq 1 500))"
if [ "$count" -eq 201 ] && [[ "$body" == *"Error: caps block 4"* ]] && [ "$(printf '%s\n' "$body" | tail -1)" = "… 40 more lines in the full output" ]; then
    ok "the Playwright blocks stop at 200 lines in all, and the cut is said"
else bad "caps: 200 lines and the cut line expected (lines: $count, last: $(printf '%s\n' "$body" | tail -1))"; fi
if printf '%s\n' "$out" | grep -qxF "$Y500 …" && ! printf '%s\n' "$out" | grep -qE 'y{501}'; then
    ok "a line over 500 characters is cut at 500"
else bad "caps: the 600-character line cut at 500 expected"; fi

# --- 4. Retention -------------------------------------------------------------------
# Twelve old runs of this worktree, a stale folder of another worktree and a fresh one.
for i in 01 02 03 04 05 06 07 08 09 10 11 12; do mkdir -p "$LOGS/$TAG/2020-01-${i}T00-00-00Z-1"; echo x >"$LOGS/$TAG/2020-01-${i}T00-00-00Z-1/01-t_.__check.log"; done
mkdir -p "$LOGS/deadbeef/2020-01-01T00-00-00Z-1" "$LOGS/cafebabe/2020-01-01T00-00-00Z-1" "$LOGS/week7aaa/r" "$LOGS/week9bbb/r"
touch -t 202001010000 "$LOGS/deadbeef/2020-01-01T00-00-00Z-1" "$LOGS/deadbeef"
age 7 "$LOGS/week7aaa"; age 9 "$LOGS/week9bbb"
# What pruning must leave alone: old entries of the state folder outside logs/, and an entry of
# this worktree's logs folder whose name is not that of a run.
S="$HARNESS_HOME/gate/state"
mkdir -p "$S/old-folder" "$LOGS/$TAG/not-a-run"
echo x >"$S/old-file.txt"; echo x >"$S/old-folder/inside.txt"; echo x >"$LOGS/$TAG/notes.txt"
touch -t 202001010000 "$S/old-file.txt" "$S/old-folder/inside.txt" "$S/old-folder" "$LOGS/$TAG/not-a-run" "$LOGS/$TAG/notes.txt"
mode ok; run
left="$(runs | wc -l | tr -d ' ')"
newest="$(newruns)"
if [ "$left" -eq 10 ] && [ -n "$newest" ] && [ -f "$(ls -d "$LOGS/$TAG/$newest"/*check*.log 2>/dev/null | head -1)" ] && [ ! -e "$LOGS/$TAG/2020-01-01T00-00-00Z-1" ]; then
    ok "retention: the newest 10 runs of the worktree are kept, this run among them"
else bad "retention: 10 runs expected, got $left ($(ls "$LOGS/$TAG" | tr '\n' ' '))"; fi
if [ ! -e "$LOGS/deadbeef" ] && [ -d "$LOGS/cafebabe" ]; then ok "retention: logs of another worktree untouched for long are removed, fresh ones kept"
else bad "retention: stale folder of another worktree expected gone, fresh one kept ($(ls "$LOGS" | tr '\n' ' '))"; fi
if [ -d "$LOGS/week7aaa" ] && [ ! -e "$LOGS/week9bbb" ]; then ok "retention: another worktree's folder 7 days old stays, one 9 days old goes"
else bad "retention: the 8-day boundary ($(ls "$LOGS" | tr '\n' ' '))"; fi
if [ -f "$S/old-file.txt" ] && [ -f "$S/old-folder/inside.txt" ] && [ -d "$LOGS/$TAG/not-a-run" ] && [ -f "$LOGS/$TAG/notes.txt" ]; then
    ok "retention: old entries outside logs/ and a non-run entry of the worktree's logs folder stay"
else bad "retention removed what is not a log run (state: $(ls "$S" | tr '\n' ' '); logs/$TAG: $(ls "$LOGS/$TAG" | tr '\n' ' '))"; fi

# --- 5. A log that cannot be written changes nothing else -----------------------------
# <state>/logs is a file: no folder can be made under it.
mv "$LOGS" "$T/logs-aside"
echo x >"$LOGS"
mode long; run
if [ "$rc" -eq 2 ] && [ "$(jq -r .outcome "$S/verdict-$TAG.json" | tr -d "\r")" = red ] && [[ "$out" == *$'\n'"--- full output: not saved, "* ]] && [[ "$out" == *"output line 500"* ]]; then
    ok "logs not writable, red run: exit 2, red verdict, the report says the log was not saved"
else bad "logs not writable, red run: rc=$rc, verdict $(jq -r .outcome "$S/verdict-$TAG.json" 2>/dev/null), out: ${out: -300}"; fi
mode ok; run
if [ "$rc" -eq 0 ] && [ "$(jq -r .outcome "$S/verdict-$TAG.json" | tr -d "\r")" = green ]; then
    ok "logs not writable, green run: exit 0, green verdict"
else bad "logs not writable, green run: rc=$rc, out: ${out:0:300}"; fi
rm "$LOGS"; mv "$T/logs-aside" "$LOGS"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
