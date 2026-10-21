#!/usr/bin/env bash
# Tests of the gate's timings: each script prints «[gate] time (<profile>): <label> <s> s» on stdout
# as it ends; a run that ran scripts or took them from the cache prints «[gate] time (<profile>):
# <s> s in all; …» right above its verdict line, on the verdict line's stream; the verdict file and
# timings.json in the folder of the run's logs carry the same figures (each script's milliseconds
# and exit code, the total).
#   - green: a line per script as it ends, then the run's line, then the verdict line, the last;
#     timings.json and the verdict file have both steps with exit 0; a script that sleeps 400 ms is
#     measured at 400 ms or more; the total is at least the sum of the steps;
#   - red: the script's line says «(exit 1)» on stdout; the run's line is on stderr right above the
#     red line; timings.json and the verdict file say red and exit 1;
#   - not verified (a script that says "command not found"): the run's line on stderr right above
#     the «not verified» line; the verdict file has the step with its exit code;
#   - a cache hit: no script line; the run's line and the verdict file name each cached script with
#     the time it took in the green run that wrote the entry; no new run folder; an entry with no
#     record of that time says «no recorded time» and null.
# Run: bash harness/hooks/tests/gate-timings.test.sh; exit code 0 means everything passed.
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

export HOME="$T/home" USERPROFILE="$T/home" HARNESS_HOME="$T/harness"
export CLAUDE_GATE_CONFIG="$T/config.json"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
mkdir -p "$HOME" "$HARNESS_HOME"
LOGS="$HARNESS_HOME/gate/state/logs"

# --- fixtures ---------------------------------------------------------------------
# The gate runs "<pm> run <script>". The package manager is fakepm.cjs (through a .cmd on Windows):
# "lint" always passes at once; "check" sleeps 400 ms, then passes (mode ok), fails (red) or says
# "command not found" (env), as $T/mode says.
cat >"$T/fakepm.cjs" <<'EOF'
const fs = require("node:fs")
const path = require("node:path")
const script = process.argv[3]
const mode = fs.readFileSync(path.join(__dirname, "mode"), "utf8").trim()
if (script === "lint") {
    process.stdout.write("lint ok\n")
    process.exit(0)
}
setTimeout(() => {
    if (mode === "env") {
        process.stdout.write("sh: fakecmd: command not found\n")
        process.exit(127)
    }
    process.stdout.write(mode === "ok" ? "check ok\n" : "check failed\n")
    process.exit(mode === "ok" ? 0 : 1)
}, 400)
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
TAG="$(tag "$(git -C "$R" rev-parse --show-toplevel)")"
n=0
touched() { n=$((n + 1)); echo "$n" >"$R/n.txt"; }   # changes the content, so the green cache misses
runs() { ls "$LOGS/$TAG" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' | LC_ALL=C sort; }
newrun() { comm -13 <(printf '%s\n' "$before") <(runs) | tail -n 1; }
# out — stdout, err — stderr, rc — the exit code.
run() {
    before="$(runs)"
    out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>"$T/err")"; rc=$?
    err="$(cat "$T/err")"
}
# An expression over the fields of a timings.json, through node: `steps[1].exit`, `total_ms >= 400`.
field() { node -e 'const r = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); with (r) process.stdout.write(String(eval(process.argv[2])))' "$@"; }
TIME_LINE='^\[gate\] time \(fast\): [0-9]+\.[0-9] s in all; t/\.:lint [0-9]+\.[0-9] s, t/\.:check [0-9]+\.[0-9] s'

VERDICT="$HARNESS_HOME/gate/state/verdict-$TAG.json"
CACHE="$HARNESS_HOME/gate/state/cache"
# The line number of the first line of $2 that matches the pattern $1, or empty.
at() { printf '%s\n' "$2" | grep -n "$1" | head -n 1 | cut -d: -f1; }

# --- 1. Green: the lines, their order, timings.json and the verdict file -------------------
mode ok; touched; run
last="$(printf '%s\n' "$out" | tail -n 1)"
time_line="$(printf '%s\n' "$out" | grep ' in all' || true)"
before_last="$(printf '%s\n' "$out" | tail -n 2 | head -n 1)"
lint_at="$(at '^\[gate\] time (fast): t/\.:lint [0-9]*\.[0-9] s$' "$out")"
check_at="$(at '^\[gate\] time (fast): t/\.:check [0-9]*\.[0-9] s$' "$out")"
total_at="$(at ' in all' "$out")"
if [ "$rc" -eq 0 ] && [ "$last" = "[gate] green (fast): t/.:lint t/.:check" ]; then ok "green: the verdict line stays the last line of stdout"
else bad "green: the verdict line last expected (rc=$rc, out: ${out:0:600}, err: ${err:0:200})"; fi
if [ -n "$lint_at" ] && [ -n "$check_at" ] && [ -n "$total_at" ] && [ "$lint_at" -lt "$check_at" ] && [ "$check_at" -lt "$total_at" ]; then
    ok "green: a line per script as it ends, lint then check, before the run's line"
else bad "green: script lines expected before the run's line (lint=$lint_at check=$check_at total=$total_at; out: ${out:0:600})"; fi
if [[ "$time_line" =~ $TIME_LINE$ ]] && [ "$before_last" = "$time_line" ]; then ok "green: the run's line names both scripts, right above the verdict line"
else bad "green: the run's line expected above the verdict line (got: '$time_line'; out: ${out:0:600})"; fi
RUN="$(newrun)"
J="$LOGS/$TAG/$RUN/timings.json"
if [ -n "$RUN" ] && [ -f "$J" ]; then ok "green: timings.json lies in the folder of the run's logs"
else bad "green: $J expected (runs: $(runs | tr '\n' ' '))"; fi
if [ -f "$J" ] && [ "$(field "$J" version)" = 1 ] && [ "$(field "$J" outcome)" = green ] && [ "$(field "$J" exit)" = 0 ] &&
    [ "$(field "$J" profile)" = fast ] && [ "$(field "$J" key)" = t ] && [ "$(field "$J" 'steps.length')" = 2 ] &&
    [ "$(field "$J" 'steps[0].step')" = "t/.:lint" ] && [ "$(field "$J" 'steps[0].script')" = lint ] && [ "$(field "$J" 'steps[0].exit')" = 0 ] &&
    [ "$(field "$J" 'steps[1].step')" = "t/.:check" ] && [ "$(field "$J" 'steps[1].exit')" = 0 ] && [ "$(field "$J" 'cached.length')" = 0 ]; then
    ok "green: timings.json holds version, outcome, exit, profile, key and both steps with exit 0"
else bad "green: timings.json fields ($(cat "$J" 2>/dev/null))"; fi
if [ -f "$J" ] && [ "$(field "$J" 'steps[1].ms >= 400')" = true ] && [ "$(field "$J" 'total_ms >= steps[0].ms + steps[1].ms')" = true ] &&
    [ "$(field "$J" 'Number.isInteger(steps[0].ms) && Number.isInteger(total_ms)')" = true ]; then
    ok "green: the 400 ms script is measured at 400 ms or more, the total covers the steps, in whole milliseconds"
else bad "green: durations ($(cat "$J" 2>/dev/null))"; fi
if [[ "$time_line" =~ t/\.:check\ ([0-9]+\.[0-9])\ s ]] && [ "$(node -e 'process.stdout.write(String(Number(process.argv[1]) >= 0.4))' "${BASH_REMATCH[1]}")" = true ]; then
    ok "green: the line shows the 400 ms script at 0.4 s or more"
else bad "green: the line's seconds for check ('$time_line')"; fi
if [ -f "$VERDICT" ] && [ "$(field "$VERDICT" outcome)" = green ] && [ "$(field "$VERDICT" 'steps.length')" = 2 ] &&
    [ "$(field "$VERDICT" 'steps[1].step')" = "t/.:check" ] && [ "$(field "$VERDICT" 'steps[1].ms >= 400')" = true ] && [ "$(field "$VERDICT" 'steps[1].exit')" = 0 ] &&
    [ "$(field "$VERDICT" 'total_ms >= steps[0].ms + steps[1].ms')" = true ] && [ "$(field "$VERDICT" 'cached.length')" = 0 ] &&
    [ "$(field "$VERDICT" 'JSON.stringify(steps) === JSON.stringify(JSON.parse(require("node:fs").readFileSync(process.argv[3], "utf8")).steps)' "$J")" = true ]; then
    ok "green: the verdict file has total_ms and the same steps as timings.json"
else bad "green: verdict file timings ($(cat "$VERDICT" 2>/dev/null))"; fi

# --- 2. Red: the exit code on the lines, in timings.json and the verdict file ---------------
mode red; touched; run
red_n="$(at '^\[gate\] red ' "$err")"
time_n="$(at ' in all' "$err")"
time_line="$(printf '%s\n' "$err" | grep ' in all' || true)"
if [ "$rc" -eq 2 ] && [[ "$time_line" =~ $TIME_LINE\ \(exit\ 1\)$ ]] && [ -n "$red_n" ] && [ "$time_n" = "$((red_n - 1))" ]; then
    ok "red: the run's line marks check with exit 1, on stderr right above the red line"
else bad "red: the run's line on stderr above the red line expected (rc=$rc, err: ${err:0:400})"; fi
if [[ "$out" != *" in all"* ]] && printf '%s\n' "$out" | grep -qE '^\[gate\] time \(fast\): t/\.:check [0-9]+\.[0-9] s \(exit 1\)$'; then
    ok "red: check's own line on stdout says exit 1; the run's line is not on stdout"
else bad "red: stdout (${out:0:400})"; fi
RUN="$(newrun)"
J="$LOGS/$TAG/$RUN/timings.json"
if [ -f "$J" ] && [ "$(field "$J" outcome)" = red ] && [ "$(field "$J" exit)" = 2 ] && [ "$(field "$J" 'steps[0].exit')" = 0 ] && [ "$(field "$J" 'steps[1].exit')" = 1 ]; then
    ok "red: timings.json says red, exit 2, and check's exit code 1"
else bad "red: timings.json ($(cat "$J" 2>/dev/null))"; fi
if [ "$(field "$VERDICT" outcome)" = red ] && [ "$(field "$VERDICT" 'steps[1].exit')" = 1 ] && [ "$(field "$VERDICT" 'typeof total_ms')" = number ]; then
    ok "red: the verdict file has check's exit code 1 and total_ms"
else bad "red: verdict file ($(cat "$VERDICT" 2>/dev/null))"; fi

# --- 3. Not verified: the run's line right above the «not verified» line ------------------
mode env; touched; run
nv_n="$(at '^\[gate\] not verified ' "$err")"
time_n="$(at ' in all' "$err")"
time_line="$(printf '%s\n' "$err" | grep ' in all' || true)"
if [ "$rc" -eq 0 ] && [ -n "$nv_n" ] && [ "$time_n" = "$((nv_n - 1))" ] && [[ "$time_line" =~ $TIME_LINE\ \(exit\ 127\)$ ]]; then
    ok "not verified: the run's line, check with exit 127, on stderr right above the «not verified» line"
else bad "not verified: the run's line above the «not verified» line expected (rc=$rc, err: ${err:0:400})"; fi
if [ "$(field "$VERDICT" outcome)" = unverified ] && [ "$(field "$VERDICT" 'steps[1].exit')" = 127 ] && [ "$(field "$VERDICT" 'typeof total_ms')" = number ]; then
    ok "not verified: the verdict file has check's exit code 127 and total_ms"
else bad "not verified: verdict file ($(cat "$VERDICT" 2>/dev/null))"; fi

# --- 4. A cache hit: the time of the green run that wrote the entry --------------------------
mode ok; touched; run
run
time_line="$(printf '%s\n' "$out" | grep '^\[gate\] time ' || true)"
CACHED_LINE='^\[gate\] time \(fast\): [0-9]+\.[0-9] s in all; cached: t/\.:lint \(green run [0-9]+\.[0-9] s\), t/\.:check \(green run ([0-9]+\.[0-9]) s\)$'
if [ "$rc" -eq 0 ] && [[ "$out" == *"(cache)"* ]] && [[ "$time_line" =~ $CACHED_LINE ]] &&
    [ "$(node -e 'process.stdout.write(String(Number(process.argv[1]) >= 0.4))' "${BASH_REMATCH[1]}")" = true ]; then
    ok "cache hit: one line, naming each cached script with the time of its green run (check 0.4 s or more)"
else bad "cache hit: the run's line with the green run's times expected (rc=$rc, lines: '$time_line', out: ${out:0:300})"; fi
if [ -z "$(newrun)" ]; then ok "cache hit: no run folder, so no timings.json"; else bad "cache hit: a run folder was written: $(newrun)"; fi
if [ "$(field "$VERDICT" 'steps.length')" = 0 ] && [ "$(field "$VERDICT" 'cached.length')" = 2 ] && [ "$(field "$VERDICT" 'cached[1].step')" = "t/.:check" ] &&
    [ "$(field "$VERDICT" 'cached[1].ms >= 400')" = true ] && [ "$(field "$VERDICT" '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(cached[1].at)')" = true ]; then
    ok "cache hit: the verdict file names the cached scripts with the green run's ms and time"
else bad "cache hit: verdict file ($(cat "$VERDICT" 2>/dev/null))"; fi
# An entry with no record of the time (as a gate of the release before wrote it).
rm -f "$CACHE"/*.time
run
time_line="$(printf '%s\n' "$out" | grep '^\[gate\] time ' || true)"
if [ "$rc" -eq 0 ] && [[ "$out" == *"(cache)"* ]] && [[ "$time_line" == *"cached: t/.:lint (no recorded time), t/.:check (no recorded time)" ]] &&
    [ "$(field "$VERDICT" 'cached[0].ms === null && cached[0].at === null')" = true ]; then
    ok "cache hit with no record: «no recorded time» on the line, null in the verdict file"
else bad "cache hit with no record (line: '$time_line'; verdict: $(cat "$VERDICT" 2>/dev/null))"; fi

echo
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
