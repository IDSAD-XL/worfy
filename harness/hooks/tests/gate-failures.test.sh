#!/usr/bin/env bash
# Tests of the failure records the gate writes (gate.mjs, its header; the format is gate-failures.mjs):
#   - each script gets GATE_FAILURES_FILE, a file of its own in the state folder, gone once it ends;
#     the next script gets another one and never sees the file of the one before;
#   - a red run writes <state>/failures/<tag>--<run>.json: the rows the reporters wrote, with the
#     step, scrubbed by the gate itself; a failed script without rows gives one record of the step
#     with the first error line of its output; `dirty` tells an uncommitted edit;
#   - the red report names the file; the verdict file, the verdict line and the exit code stay as
#     they were; a green run, a run where nothing ran and a script whose environment is missing
#     write no records; a stopped run leaves no file at all; records older than 60 days are removed.
# Run: bash harness/hooks/tests/gate-failures.test.sh; exit code 0 means everything passed.
# HOOKS_DIR runs the test on another copy of the hooks (for example, on the version before an edit).
#
# HOME, HARNESS_HOME, CLAUDE_GATE_STATE, the registry and the repository are temporary: the test
# does not touch the live registry, state folder or markers.
set -u
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
HOOKS="${HOOKS_DIR:-$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })}"
GATE="$HOOKS/gate.mjs"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
unset CLAUDE_CODE_SESSION_ID GATE_SCOPE EVAL_HARNESS_HOME GATE_FAILURES_FILE
T="$(mktemp -d)" || exit 1
[ -d "$T" ] || exit 1
T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
tag() { node -e 'process.stdout.write(require("node:crypto").createHash("sha1").update(process.argv[1]).digest("hex").slice(0, 8))' "$1"; }

export HOME="$T/home" USERPROFILE="$T/home" HARNESS_HOME="$T/harness" CLAUDE_GATE_STATE="$T/state"
export CLAUDE_GATE_CONFIG="$T/config.json"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
mkdir -p "$HOME" "$HARNESS_HOME" "$CLAUDE_GATE_STATE"
STATE="$CLAUDE_GATE_STATE"
FAILURES="$STATE/failures"
# The home folder of a made-up macOS user, put together from pieces so that this file holds no such path.
export JDOE="/Us""ers/jdoe"

# --- fixtures ---------------------------------------------------------------------
# The gate runs "<pm> run <script>" for lint, test and e2e. The package manager is fakepm.cjs
# (through a .cmd on Windows, so the gate starts it through cmd.exe there). Each script prints
# FILE=<its GATE_FAILURES_FILE>; e2e also prints LIST=<the names in the state folder>. $T/mode says
# what lint and test do:
#   lintbad — lint prints a line, an error line with the home folder in it and a last line, exit 1;
#   rows    — test writes two rows to its GATE_FAILURES_FILE, exit 1;
#   norows  — test fails without rows; its last line is «Tests 1 failed»;
#   home    — test writes a row with $JDOE (a macOS home folder) in its error and its name, exit 1;
#   broken  — test writes one row, a line that is not JSON and a row with a wrong `ms`, exit 1;
#   env     — test writes a row and says "command not found", exit 127;
#   wait    — test writes a row, says it started ($T/started) and waits for SIGTERM, exit 1 on it;
#   ok      — everything passes.
cat >"$T/fakepm.cjs" <<'EOF'
const fs = require("node:fs")
const path = require("node:path")
const script = process.argv[3]
const mode = fs.readFileSync(path.join(__dirname, "mode"), "utf8").trim()
const file = process.env.GATE_FAILURES_FILE
const say = (text) => process.stdout.write(`${text}\n`)
const row = (name, error, extra = {}) =>
    `${JSON.stringify({ runner: "vitest", file: "test/a.test.ts", line: 3, name, test: null, ms: 12, error, attempt: 1, rerun: ["node", "x.mjs", "test/a.test.ts"], ...extra })}\n`
const write = (...rows) => fs.appendFileSync(file, rows.join(""))
say(`FILE=${file ?? ""}`)
if (script === "e2e") {
    say(`LIST=${fs.readdirSync(process.env.CLAUDE_GATE_STATE).join(",")}`)
    process.exit(0)
}
if (script === "lint") {
    if (mode !== "lintbad") process.exit(0)
    say("starting lint")
    say(`${process.env.HOME}/src/a.ts:1:1 error  'x' is never used`)
    say("1 problem")
    process.exit(1)
}
if (mode === "rows") {
    write(row("suite > first", "AssertionError: expected 1 to be 2"), row("suite > second", "Error: boom"))
    process.exit(1)
}
if (mode === "norows") {
    say("running tests")
    say("Tests 1 failed")
    process.exit(1)
}
if (mode === "home") {
    write(row(`suite ${process.env.JDOE}/proj > works`, `AssertionError at ${process.env.JDOE}/proj/a.test.ts:3`))
    process.exit(1)
}
if (mode === "broken") {
    write(row("suite > kept", "Error: kept"), "not json\n", row("suite > bad ms", "Error: x", { ms: "soon" }))
    process.exit(1)
}
if (mode === "env") {
    write(row("suite > env", "Error: env"))
    say("sh: fakecmd: command not found")
    process.exit(127)
}
if (mode === "wait") {
    write(row("suite > stopped", "Error: stopped"))
    process.on("SIGTERM", () => process.exit(1))
    fs.writeFileSync(path.join(__dirname, "started"), "test\n")
    setTimeout(() => process.exit(7), 20000)
    return
}
process.exit(0)
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
echo '{ "name": "fixture", "scripts": { "lint": "true", "test": "true", "e2e": "true" } }' >"$R/package.json"
git -C "$R" add package.json
git -C "$R" commit -q -m init
git -C "$R" update-ref refs/remotes/origin/main HEAD
jq -n --arg r "$R" --arg pm "$PM" '{repos: [{key: "t", match: $r, pm: $pm, root: {fast: ["lint", "test", "e2e"]}, workspace: {}}]}' >"$CLAUDE_GATE_CONFIG"
TAG="$(tag "$(git -C "$R" rev-parse --show-toplevel)")"
VERDICT="$STATE/verdict-$TAG.json"
LOGS="$STATE/logs/$TAG"
n=0
touched() { n=$((n + 1)); echo "$n" >"$R/n.txt"; }   # an uncommitted edit
committed() { touched; git -C "$R" add n.txt && git -C "$R" commit -q -m "edit $n"; }
records() { ls "$FAILURES" 2>/dev/null | grep -E '\.json$' | LC_ALL=C sort; }
leftovers() { ls -A "$STATE" | grep -E '^\.run-.*\.failures\.jsonl$' || true; }
# out — stdout, err — stderr, rc — the exit code; new — the run file this run added, or empty.
run() {
    local before
    before="$(records)"
    out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>"$T/err")"; rc=$?
    err="$(cat "$T/err")"
    new="$(comm -13 <(printf '%s\n' "$before") <(records) | tail -n 1)"
}
# The newest log folder of the worktree, and the output of script NN in it.
lastrun() { ls "$LOGS" 2>/dev/null | grep -E '^[0-9]{4}-' | LC_ALL=C sort | tail -n 1; }
logof() { cat "$LOGS/$(lastrun)/$1"-*.log 2>/dev/null; }
# An expression over the fields of the run file $1, through node: `failures.length`, `dirty`.
field() { node -e 'const r = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); with (r) process.stdout.write(String(eval(process.argv[2])))' "$@"; }
# The verdict file without the fields that tell the time.
timeless() { jq -S 'del(.at, .total_ms) | .steps |= map(del(.ms)) | .cached |= map(del(.ms, .at))' "$VERDICT"; }

# --- 1. Two rows of a failed test: the run file, the step, HEAD, the verdict line ----------
mode rows; run
F="$FAILURES/$new"
if [ -n "$new" ] && [ -f "$F" ]; then ok "rows: a red run writes a run file in <state>/failures"
else bad "rows: no run file (rc=$rc, records: $(records | tr '\n' ' '), err: ${err:0:600})"; fi
if [ "$new" = "$TAG--$(lastrun).json" ] && [ "$(field "$F" run 2>/dev/null)" = "$TAG/$(lastrun)" ]; then ok "rows: the run id is <tag>/<the run's log folder>, the file <tag>--<run>.json"
else bad "rows: run id (file: $new, run: $(field "$F" run 2>/dev/null), log folder: $(lastrun))"; fi
if [ "$(field "$F" 'failures.length' 2>/dev/null)" = 2 ] \
    && [ "$(field "$F" 'failures.map((f) => f.step + "|" + f.name + "|" + f.test).join(",")' 2>/dev/null)" = "t/.:test|suite > first|vitest test/a.test.ts > suite > first,t/.:test|suite > second|vitest test/a.test.ts > suite > second" ]; then
    ok "rows: two records, each with the label of its script as step and its test id"
else bad "rows: records ($(field "$F" 'JSON.stringify(failures)' 2>/dev/null | head -c 600))"; fi
if [ "$(field "$F" head 2>/dev/null)" = "$(git -C "$R" rev-parse HEAD)" ] && [ "$(field "$F" '[kind, key, profile, outcome, dirty].join(" ")' 2>/dev/null)" = "run t fast red false" ] \
    && [ "$(field "$F" '/^[0-9a-f]{8}$/.test(computer.id) && computer.platform === process.platform' 2>/dev/null)" = true ]; then
    ok "rows: head is HEAD; kind, key, profile, outcome; a clean tree is dirty: false; the computer of machine.json"
else bad "rows: run fields ($(head -c 600 "$F" 2>/dev/null))"; fi
red_line="$(printf '%s\n' "$err" | grep '^\[gate\] red' || true)"
if [ "$rc" -eq 2 ] && [ "$red_line" = "[gate] red (fast): t/.:test (passed: t/.:lint t/.:e2e)" ]; then ok "rows: exit 2 and the red line as before"
else bad "rows: rc=$rc, red line: '$red_line'"; fi
if printf '%s\n' "$err" | grep -qxF -- "--- failure records: $STATE/failures/$new (2 tests, 0 steps without tests)" \
    || printf '%s\n' "$err" | grep -q -- "^--- failure records: .*$new (2 tests, 0 steps without tests)$"; then
    ok "rows: the red report names the run file and counts 2 tests"
else bad "rows: no line «--- failure records:» (err: ${err:0:900})"; fi
if [ "$(printf '%s\n' "$err" | grep -n -- '^--- failure records:' | cut -d: -f1)" -gt "$(printf '%s\n' "$err" | grep -n -- '^--- full output' | tail -n 1 | cut -d: -f1)" ] 2>/dev/null; then
    ok "rows: the line comes after «full output»"
else bad "rows: the line «--- failure records:» is not after «full output» (err: ${err:0:900})"; fi

# --- 2. The file of each script: its own, gone once it ends, not seen by the next one -------
test_file="$(logof 02 | sed -n 's/^FILE=//p')"
e2e_file="$(logof 03 | sed -n 's/^FILE=//p')"
e2e_list="$(logof 03 | sed -n 's/^LIST=//p')"
if [[ "$(basename "$test_file")" =~ ^\.run-$TAG-[0-9]+-02\.failures\.jsonl$ ]] && [ "$(cd "$(dirname "$test_file")" && { pwd -W 2>/dev/null || pwd -P; })" = "$STATE" ]; then
    ok "files: GATE_FAILURES_FILE is <state>/.run-<tag>-<pid>-<NN>.failures.jsonl"
else bad "files: GATE_FAILURES_FILE of test is '$test_file'"; fi
if [ -n "$e2e_file" ] && [ "$e2e_file" != "$test_file" ]; then ok "files: the next script gets a GATE_FAILURES_FILE of its own"
else bad "files: e2e saw '$e2e_file', test had '$test_file'"; fi
if [[ ",$e2e_list," != *",$(basename "$test_file"),"* ]] && [[ "$e2e_list" != *failures.jsonl* ]] && [[ "$e2e_list" == *verdict-* || "$e2e_list" == *cache* ]]; then
    ok "files: the file of test is gone before e2e starts"
else bad "files: the state folder seen by e2e: '$e2e_list' (test had $(basename "$test_file"))"; fi
if [ -z "$(leftovers)" ]; then ok "files: no .run-…failures.jsonl in the state folder after the run"
else bad "files: left in the state folder: $(leftovers)"; fi

# --- 3. The verdict file does not change with the records ---------------------------------
v_rows="$(timeless)"
mode norows; run
v_norows="$(timeless)"
if [ -n "$v_rows" ] && [ "$v_rows" = "$v_norows" ]; then ok "verdict: the same verdict file with rows and without, but for the times"
else bad "verdict: with rows: $v_rows; without: $v_norows"; fi

# --- 4. A failed script without rows: one record of the step ------------------------------
F="$FAILURES/$new"
if [ -n "$new" ] && [ "$(field "$F" 'JSON.stringify(failures.map((f) => [f.step, f.runner, f.file, f.line, f.name, f.test, f.error, f.attempt, f.rerun]))' 2>/dev/null)" = '[["t/.:test",null,null,null,null,null,"Tests 1 failed",1,null]]' ] \
    && [ "$(field "$F" 'Number.isInteger(failures[0].ms)' 2>/dev/null)" = true ]; then
    ok "no rows: one record of the step, runner/file/name null, the last line as error, the script's ms"
else bad "no rows: ($(head -c 700 "$F" 2>/dev/null))"; fi
if printf '%s\n' "$err" | grep -q -- '^--- failure records: .* (0 tests, 1 steps without tests)$'; then ok "no rows: the report counts 1 step without tests"
else bad "no rows: report line ($(printf '%s\n' "$err" | grep -- '--- failure records' || true))"; fi

mode lintbad; run
F="$FAILURES/$new"
lint_error="$(field "$F" 'failures.filter((f) => f.step === "t/.:lint").map((f) => f.error).join("|")' 2>/dev/null)"
if [ "$lint_error" = "~/src/a.ts:1:1 error  'x' is never used" ] && [ "$(field "$F" 'failures.length' 2>/dev/null)" = 1 ]; then
    ok "lint: one record, the first line with «error», the home folder as ~"
else bad "lint: error '$lint_error' ($(head -c 600 "$F" 2>/dev/null))"; fi
if ! grep -qF -- "$HOME" "$F" 2>/dev/null && ! grep -qF -- "$T" "$F" 2>/dev/null; then ok "lint: no path of the home folder or the test folder in the run file"
else bad "lint: a personal path in the run file ($(head -c 600 "$F"))"; fi

# --- 5. The gate scrubs the rows itself -----------------------------------------------------
mode home
before="$(records)"
out="$(cd "$R" && HOME="$JDOE" USERPROFILE="$JDOE" GATE_SCOPE=all node "$GATE" fast </dev/null 2>"$T/err")"; rc=$?
new="$(comm -13 <(printf '%s\n' "$before") <(records) | tail -n 1)"
F="$FAILURES/$new"
got="$(field "$F" 'failures[0].error + "|" + failures[0].name + "|" + failures[0].test' 2>/dev/null)"
if [ -n "$new" ] && [ "$got" = "AssertionError at ~/proj/a.test.ts:3|suite ~/proj > works|vitest test/a.test.ts > suite ~/proj > works" ] && ! grep -q jdoe "$F"; then
    ok "scrub: $JDOE/… of the reporter's row is ~/… in the run file, its test id too"
else bad "scrub: got '$got' (rc=$rc, $(head -c 600 "$F" 2>/dev/null))"; fi

# --- 6. Broken rows are skipped and counted -------------------------------------------------
mode broken; run
F="$FAILURES/$new"
got="$(field "$F" 'JSON.stringify(failures.map((f) => [f.runner, f.name, f.skipped ?? null]))' 2>/dev/null)"
if [ "$got" = '[["vitest","suite > kept",null],[null,null,2]]' ]; then ok "broken: the good row is kept; the record of the step counts the 2 skipped lines"
else bad "broken: records $got"; fi

# --- 7. dirty: an uncommitted edit, then a clean tree --------------------------------------
mode rows; touched; run
F="$FAILURES/$new"
if [ -n "$new" ] && [ "$(field "$F" dirty 2>/dev/null)" = true ]; then ok "dirty: an uncommitted edit -> dirty: true"
else bad "dirty: with an uncommitted edit: '$(field "$F" dirty 2>/dev/null)'"; fi
committed; run
F="$FAILURES/$new"
if [ -n "$new" ] && [ "$(field "$F" dirty 2>/dev/null)" = false ] && [ "$(field "$F" head 2>/dev/null)" = "$(git -C "$R" rev-parse HEAD)" ]; then ok "dirty: the same edit committed -> dirty: false, head the new commit"
else bad "dirty: on a clean tree: '$(field "$F" dirty 2>/dev/null)'"; fi

# --- 8. Runs that write no records -----------------------------------------------------------
mode ok; touched; run
if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] green (fast)"* ]] && [ -z "$new" ] && [ -z "$(leftovers)" ]; then ok "green: no run file, no temporary file"
else bad "green: rc=$rc, new: '$new', left: $(leftovers), out: ${out:0:300}"; fi
committed; git -C "$R" update-ref refs/remotes/origin/main HEAD
before="$(records)"
out="$(cd "$R" && node "$GATE" fast </dev/null 2>"$T/err")"; rc=$?
new="$(comm -13 <(printf '%s\n' "$before") <(records) | tail -n 1)"
if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] nothing ran (fast)"* ]] && [ -z "$new" ]; then ok "nothing ran: no run file"
else bad "nothing ran: rc=$rc, new: '$new', out: ${out:0:300}"; fi
mode env; touched; run
if [ "$rc" -eq 0 ] && [[ "$err" == *"[gate] not verified — environment unavailable"* ]] && [ -z "$new" ] && [ -z "$(leftovers)" ]; then
    ok "environment unavailable: the row of the script gives no record, no temporary file is left"
else bad "environment unavailable: rc=$rc, new: '$new', left: $(leftovers), err: ${err:0:300}"; fi

# --- 9. A stopped run leaves nothing -------------------------------------------------------
# Not on Windows: SIGTERM there kills node without a word (gate-verdict-signals.test.sh skips it too).
if [ "$WIN" -eq 1 ]; then echo "skip the stopped run: Windows has no SIGTERM for node"; else
    mode wait; touched
    before="$(records)"
    rm -f "$T/started"
    # set -m: the gate leads a process group of its own, so the signal reaches it and the script
    # together, as when a hook runs out of time; exec: the job is the gate itself.
    set -m
    (cd "$R" && export GATE_SCOPE=all && exec node "$GATE" fast) </dev/null >"$T/stop.out" 2>&1 &
    pid=$!
    set +m
    for _ in $(seq 1 300); do [ -s "$T/started" ] && break; sleep 0.1; done
    if [ -s "$T/started" ]; then kill -s TERM -- "-$pid"; else kill -s KILL -- "-$pid"; fi
    wait "$pid"; rc=$?
    new="$(comm -13 <(printf '%s\n' "$before") <(records) | tail -n 1)"
    if [ "$rc" -eq 143 ] && [ -z "$new" ] && [ -z "$(leftovers)" ]; then ok "stopped: SIGTERM while the script runs leaves no run file and no .run-…failures.jsonl"
    else bad "stopped: rc=$rc (expected 143), new: '$new', left: $(leftovers), out: $(head -c 300 "$T/stop.out")"; fi
fi

# --- 10. Records older than 60 days are removed after a new red run ------------------------
mkdir -p "$FAILURES"
old='{"version":1,"kind":"run","run":"0000aaaa/old","at":"2020-01-01T00:00:00Z","key":"t","profile":"fast","head":null,"outcome":"red","computer":{"id":"0123abcd","name":"mac","platform":"darwin"},"dirty":false,"failures":[]}'
recent="$(node -e 'const at = new Date(Date.now() - 59 * 864e5).toISOString().replace(/\.\d+Z$/, "Z"); process.stdout.write(process.argv[1].replace("2020-01-01T00:00:00Z", at).replace("/old", "/recent"))' "$old")"
printf '%s\n' "$old" >"$FAILURES/0000aaaa--old.json"
printf '%s\n' "$recent" >"$FAILURES/0000aaaa--recent.json"
mode rows; touched; run
if [ ! -e "$FAILURES/0000aaaa--old.json" ] && [ -e "$FAILURES/0000aaaa--recent.json" ] && [ -n "$new" ]; then ok "retention: a run file of 60+ days is removed, one of 59 days stays"
else bad "retention: records now $(records | tr '\n' ' ')"; fi

echo
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
