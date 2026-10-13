#!/usr/bin/env bash
# Tests of the gate's verdict file (ticket worfy-harness/09): every run of gate.mjs in a git
# worktree leaves verdict-<tag>.json in the gate state folder, next to the markers, with the
# outcome of that run in English keys and values. A directory outside git leaves no file.
#   - each path of gate.mjs: green (a fresh run and a cache hit), red, environment unavailable
#     (the message of sh and the one of cmd.exe, a package manager that is not installed), the
#     registry resolver crashed, not registered, the plan resolver crashed, nothing ran;
#   - a worktree path with a space, a quote and a backslash still gives a parseable file;
#   - a second run overwrites the file; no temporary files are left in the state folder.
# Run: bash harness/hooks/tests/gate-verdict.test.sh; exit code 0 means everything passed.
# HOOKS_DIR runs the test on another copy of the hooks (for example, on the version before an edit).
#
# The registry, the state folder and the repositories are temporary (CLAUDE_GATE_CONFIG,
# CLAUDE_GATE_STATE): the test does not touch the live registry or markers.
#
# There is no "node not found" case (worfy-windows ticket 03): the gate is a Node script, so
# without node it does not start and writes nothing — see the header of gate.mjs.
set -u
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads; a path like
# /c/… or /tmp/… means nothing to node. Elsewhere there is no -W.
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
HOOKS="${HOOKS_DIR:-$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })}"   # the hooks next to this test (harness/hooks)
GATE="$HOOKS/gate.mjs"
REAL_RESOLVE="$HOOKS/gate-resolve.mjs"
export CLAUDE_GATE_RESOLVE="$REAL_RESOLVE"
unset CLAUDE_CODE_SESSION_ID GATE_SCOPE HARNESS_HOME
T="$(mktemp -d)" || exit 1
[ -d "$T" ] || exit 1
T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
# The tag of a worktree, as the gate counts it: the first 8 hex digits of the SHA-1 of its path.
# node, not shasum: Git Bash has shasum only where perl is on PATH.
tag() { node -e 'process.stdout.write(require("node:crypto").createHash("sha1").update(process.argv[1]).digest("hex").slice(0, 8))' "$1"; }
jqr() { jq -r "$@" | tr -d '\r'; }   # jq.exe ends its lines with CR LF
STATE="$T/state"
export CLAUDE_GATE_STATE="$STATE" CLAUDE_GATE_CONFIG="$T/config.json"
mkdir -p "$STATE"

# verdict <description> <worktree> <jq condition> [jq args...]: the file of that worktree exists,
# is valid JSON with the common keys right, and the condition holds.
verdict() {
    local d="$1" wt="$2" cond="$3"; shift 3
    local f="$STATE/verdict-$(tag "$wt").json"
    if [ ! -f "$f" ]; then bad "$d (no $f; rc=$rc, out: ${out:0:300})"; return; fi
    if jq -e --arg wt "$wt" "$@" '
        .version == 1
        and (.outcome | IN("green", "red", "unverified", "none"))
        and (.profile | type == "string")
        and .worktree == $wt
        and (.key == null or (.key | type == "string"))
        and (.head == null or (.head | test("^[0-9a-f]{40}$")))
        and (.exit | type == "number")
        and (.at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
        and (if (.outcome | IN("unverified", "none")) then (.reason | type == "string" and length > 0 and (contains("\n") | not)) else .reason == null end)
        and ('"$cond"')' "$f" >/dev/null 2>&1; then
        ok "$d"
    else
        bad "$d (rc=$rc, file: $(head -c 400 "$f"), out: ${out:0:200})"
    fi
}

# --- fixtures ---------------------------------------------------------------------
# The gate runs "$PM run <script>"; pm is this file, so the test needs no npm. What the script
# does is set by $T/mode: ok, bad (a real test failure), envbad (a missing tool, in the words of
# sh) or envbad-cmd (the same in the words of cmd.exe); term ends the script by SIGTERM, and
# termparent sends SIGTERM to the gate and ends well. On Windows the file is a .cmd: node starts
# nothing else there without an interpreter, and a .cmd knows no signals.
if [ "$WIN" -eq 1 ]; then
    PM="$T/fakepm.cmd"
    cat >"$PM" <<'EOF'
@echo off
set /p m=<"%~dp0mode"
if "%m%"=="ok" exit /b 0
if "%m%"=="bad" (echo Tests 1 failed& exit /b 1)
if "%m%"=="envbad" (echo sh: tool: command not found& exit /b 127)
if "%m%"=="envbad-cmd" (echo 'tool' is not recognized as an internal or external command,& exit /b 1)
if "%m%"=="mixed" (echo sh: tool: command not found& echo Tests 1 failed& exit /b 1)
if "%m%"=="big" goto big
exit /b 1
:big
node -e "process.stdout.write(('x'.repeat(99) + '\n').repeat(20000))"
echo sh: tool: command not found
exit /b 127
EOF
else
    PM="$T/fakepm"
    cat >"$PM" <<EOF
#!/bin/sh
case "\$(cat "$T/mode")" in
    ok) exit 0 ;;
    bad) echo "Tests 1 failed"; exit 1 ;;
    envbad) echo "sh: tool: command not found"; exit 127 ;;
    envbad-cmd) echo "'tool' is not recognized as an internal or external command,"; exit 1 ;;
    mixed) echo "sh: tool: command not found"; echo "Tests 1 failed"; exit 1 ;;
    big) node -e "process.stdout.write(('x'.repeat(99) + '\n').repeat(20000))"; echo "sh: tool: command not found"; exit 127 ;;
    term) kill -TERM \$\$; sleep 5 ;;
    termparent) kill -TERM \$PPID; exit 0 ;;
esac
exit 1
EOF
    chmod +x "$PM"
fi
mode() { echo "$1" >"$T/mode"; }

newrepo() { # $1 = path, $2 = script name (default check): a repository with one commit and origin/main at it
    mkdir -p "$1"
    git -C "$1" init -q -b main
    echo "{ \"name\": \"fixture\", \"scripts\": { \"${2:-check}\": \"true\" } }" >"$1/package.json"
    git -C "$1" add package.json
    git -C "$1" -c user.email=t@t -c user.name=t commit -q -m init
    git -C "$1" update-ref refs/remotes/origin/main HEAD
}
R="$T/reg"          # registered, key "t"
Q="$T/quiet"        # registered, key "q": profile fast only
U="$T/unreg"        # not registered
M="$T/nopm"         # registered, key "m": its package manager is not installed
P="$T/percent"      # registered, key "p": a script name with a percent sign
# registered, key "w": a path with a space, quotes and a backslash. A file name on Windows takes
# neither a double quote nor a backslash: there the path keeps the space and the single quote.
if [ "$WIN" -eq 1 ]; then W="$T/sp ace'x"; else W="$T/sp ace\"quo\\te'x"; fi
for r in "$R" "$Q" "$U" "$W" "$M"; do newrepo "$r"; done
newrepo "$P" 'a%b'
# Only Windows runs the next five (cmd.exe and the names of Windows); their registry entries
# stand on every system and are simply never used elsewhere.
C="$T/cmdmsg"       # key "c": its package manager is a .cmd that calls a tool that does not exist
A="$T/args"         # key "a": a package manager in a folder with a space, a script name with `&`
L="$T/local"        # key "l": a package manager that lies only in the repository folder
S="$T/slash"        # key "s": a workspace entry written with a backslash
X="$T/long"         # key "x": a script name that makes the command line longer than cmd.exe takes
LONG="$(printf 'a%.0s' $(seq 1 8100))"
jq -n --arg r "$R" --arg q "$Q" --arg w "$W" --arg m "$M" --arg p "$P" --arg pm "$PM" \
    --arg c "$C" --arg cpm "$T/realpm.cmd" --arg a "$A" --arg apm "$T/sp dir/argpm.cmd" --arg l "$L" --arg s "$S" --arg x "$X" --arg long "$LONG" '{repos: [
    {key: "t", match: $r, pm: $pm, root: {fast: ["check"], full: ["check"]}, workspace: {}},
    {key: "q", match: $q, pm: $pm, root: {fast: ["check"]}, workspace: {}},
    {key: "w", match: $w, pm: $pm, root: {fast: ["check"]}, workspace: {}},
    {key: "m", match: $m, pm: "worfy-no-such-package-manager", root: {fast: ["check"]}, workspace: {}},
    {key: "p", match: $p, pm: $pm, root: {fast: ["a%b"]}, workspace: {}},
    {key: "c", match: $c, pm: $cpm, root: {fast: ["check"]}, workspace: {}},
    {key: "a", match: $a, pm: $apm, root: {fast: ["x&y"]}, workspace: {}},
    {key: "l", match: $l, pm: "localonly", root: {fast: ["check"]}, workspace: {}},
    {key: "s", match: $s, pm: "npm", root: {}, workspace: {fast: ["check"]}},
    {key: "x", match: $x, pm: $pm, root: {fast: [$long]}, workspace: {}}
]}' >"$CLAUDE_GATE_CONFIG"
HEAD_R="$(git -C "$R" rev-parse HEAD)"
n=0
touched() { n=$((n + 1)); echo "$n" >"$R/n.txt"; }   # changes the content, so the green cache misses

# --- 1. Green: a fresh run, then a cache hit ----------------------------------------
mode ok; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "green run -> outcome green, exit 0, profile fast, key t, head" "$R" \
    '.outcome == "green" and .exit == 0 and .profile == "fast" and .key == "t" and .head == $head' --arg head "$HEAD_R"
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [[ "$out" == *"(кэш)"* ]]; then ok "second green run is a cache hit"; else bad "cache hit expected (rc=$rc, out: ${out:0:200})"; fi
verdict "green from cache -> outcome green, exit 0" "$R" '.outcome == "green" and .exit == 0 and .key == "t"'

# --- 2. Red; a second run overwrites the file -----------------------------------------
mode bad; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" full </dev/null 2>&1)"; rc=$?
verdict "red run (full) -> outcome red, exit 2, profile full" "$R" '.outcome == "red" and .exit == 2 and .profile == "full" and .key == "t"'
# The red marker is what stop.sh holds a turn on: a red run leaves it, a green run removes it.
if [ -s "$STATE/red-t-$(tag "$R")" ]; then ok "red run leaves the red marker of the worktree"; else bad "red run: no red marker (state: $(ls "$STATE" | tr '\n' ' '))"; fi
mode ok; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "a later green run overwrites red with green" "$R" '.outcome == "green" and .exit == 0 and .profile == "fast"'
if [ ! -e "$STATE/red-t-$(tag "$R")" ]; then ok "a later green run removes the red marker"; else bad "the red marker is left after a green run"; fi
# The output of a script is read to its last line, however long it is: 2 MB here, and only the
# last line says that a tool is missing.
mode big; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "2 MB of output with the sign of a missing tool in the last line -> outcome unverified" "$R" \
    '.outcome == "unverified" and .exit == 0 and .key == "t" and (.reason | endswith("sh: tool: command not found"))'
mode ok

# --- 3. Environment unavailable ------------------------------------------------------
mode envbad; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "environment unavailable -> outcome unverified, exit 0, a reason" "$R" '.outcome == "unverified" and .exit == 0 and .key == "t"'
# A line of output ends with CR LF on Windows: the carriage return is not part of the line.
verdict "environment unavailable: the reason ends with the words of the script, no carriage return" "$R" \
    '(.reason | endswith("sh: tool: command not found")) and (.reason | contains("\r") | not)'
um="$STATE/unverified-t-$(tag "$R")"
if [ -s "$um" ] && ! grep -q "$(printf '\r')" "$um" && [[ "$out" != *"$(printf '\r')"* ]]; then ok "environment unavailable: no carriage return in the marker or in the lines of the gate"
else bad "a carriage return in the marker or the output (marker: $(od -c "$um" 2>/dev/null | head -n 5 | tr '\n' ' '))"; fi
# cmd.exe names a missing tool in its own words; the text is the same sign on every system.
mode envbad-cmd; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "environment unavailable in the words of cmd.exe -> outcome unverified, exit 0" "$R" \
    '.outcome == "unverified" and .exit == 0 and (.reason | contains("is not recognized as an internal or external command"))'
if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ — окружение недоступно:"* ]]; then ok "the words of cmd.exe: exit 0 and the «окружение недоступно» line"
else bad "the words of cmd.exe: rc=$rc, out: ${out:0:300}"; fi
# The same words next to a report of a failed test: the tests did run, so the run is red.
mode mixed; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "a missing tool and a failed test in one output -> outcome red, exit 2" "$R" '.outcome == "red" and .exit == 2 and .key == "t"'
mode ok
# The package manager of the registry entry is not installed: the gate says so itself, in the
# same words on every system, whatever language the shell of that system speaks.
echo 1 >"$M/n.txt"
out="$(cd "$M" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "package manager not installed -> outcome unverified, exit 0, key m" "$M" \
    '.outcome == "unverified" and .exit == 0 and .key == "m" and (.reason | contains("worfy-no-such-package-manager: command not found"))'
# A script name with a percent sign. cmd.exe would expand it even inside quotes, so on Windows
# the gate does not start such a script and says "could not verify"; elsewhere no shell reads it.
echo 1 >"$P/n.txt"
out="$(cd "$P" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
if [ "$WIN" -eq 1 ]; then
    verdict "Windows: a script name cmd.exe cannot carry -> outcome unverified, exit 0" "$P" '.outcome == "unverified" and .exit == 0 and .key == "p"'
else
    verdict "a script name with a percent sign runs as it is -> outcome green" "$P" '.outcome == "green" and .exit == 0 and .key == "p"'
fi
# A package manager whose name is empty (a resolver that names none): a shell would say
# ": command not found", and so does the gate — the environment, not a crash of the gate.
cat >"$T/no-pm.mjs" <<EOF
import { spawnSync } from "node:child_process"
if (process.argv[2] === "--which") {
    console.log(["t", process.argv[3], ""].join("\t"))
    process.exit(0)
}
const r = spawnSync(process.execPath, [process.env.REAL_RESOLVE, ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(r.status ?? 1)
EOF
touched
out="$(cd "$R" && GATE_SCOPE=all REAL_RESOLVE="$REAL_RESOLVE" CLAUDE_GATE_RESOLVE="$T/no-pm.mjs" node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "an empty package manager -> outcome unverified, exit 0, \"command not found\"" "$R" \
    '.outcome == "unverified" and .exit == 0 and .key == "t" and (.reason | contains(": command not found"))'
if [ "$rc" -eq 0 ]; then ok "an empty package manager: exit 0"; else bad "an empty package manager: rc=$rc, out: ${out:0:300}"; fi

# --- 3w. Windows: the package manager goes through cmd.exe ---------------------------------
if [ "$WIN" -eq 1 ]; then
    # (a) A real message of cmd.exe, not an echoed sentence: the package manager is a .cmd that
    # calls a tool that does not exist. cmd.exe of a Russian Windows says so in Russian and in
    # code page 866 unless it starts in a UTF-8 console; then it is the English sentence, which is
    # one of the signs of a missing environment. The gate gives the script a console of its own,
    # which starts at the code page of the system whatever console this test runs in. (On a
    # Windows whose cmd.exe speaks English anyway the check cannot fail.)
    newrepo "$C"
    printf '@worfy-no-such-tool-of-ticket-03 %%*\r\n' >"$T/realpm.cmd"
    echo 1 >"$C/n.txt"
    out="$(cd "$C" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    verdict "cmd.exe itself names a missing tool -> outcome unverified, exit 0, the English sign" "$C" \
        '.outcome == "unverified" and .exit == 0 and .key == "c" and (.reason | contains("is not recognized as an internal or external command"))'
    if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ — окружение недоступно:"* ]]; then ok "cmd.exe itself names a missing tool: exit 0 and the «окружение недоступно» line"
    else bad "cmd.exe itself names a missing tool: rc=$rc, out: ${out:0:400}"; fi

    # (b) ComSpec may name another shell (PowerShell): the gate starts cmd.exe of the system anyway.
    mode ok; touched
    out="$(cd "$R" && COMSPEC=powershell.exe GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] зелено (fast): t/.:check"* ]]; then ok "ComSpec names PowerShell: the script still runs, green"
    else bad "ComSpec names PowerShell: rc=$rc, out: ${out:0:300}"; fi

    # (c) A word with a space (the folder of the package manager) and a word with `&` (the script
    # name) reach a .cmd as they are: the .cmd writes down what it was given.
    newrepo "$A" 'x&y'
    mkdir -p "$T/sp dir"
    printf '@echo off\r\n>>"%%~dp0args.log" echo %%*\r\nexit /b 0\r\n' >"$T/sp dir/argpm.cmd"
    echo 1 >"$A/n.txt"
    out="$(cd "$A" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    verdict "a package manager in a folder with a space, a script name with & -> outcome green" "$A" '.outcome == "green" and .exit == 0 and .key == "a"'
    if [ "$(tr -d '\r' <"$T/sp dir/args.log" 2>/dev/null)" = '"run" "x&y" ' ] || [ "$(tr -d '\r' <"$T/sp dir/args.log" 2>/dev/null)" = '"run" "x&y"' ]; then ok "the .cmd was given \"run\" \"x&y\", each word whole"
    else bad "the .cmd was given: $(cat "$T/sp dir/args.log" 2>/dev/null)"; fi

    # (d) cmd.exe looks for a program in the current folder first; the gate does not. A package
    # manager that lies only in the repository is "command not found", not a program to start.
    newrepo "$L"
    printf '@echo off\r\necho started from the repository folder>"%%~dp0started.txt"\r\nexit /b 0\r\n' >"$L/localonly.cmd"
    out="$(cd "$L" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    verdict "a package manager only in the repository folder -> outcome unverified, \"command not found\"" "$L" \
        '.outcome == "unverified" and .exit == 0 and .key == "l" and (.reason | contains("localonly: command not found"))'
    if [ ! -e "$L/started.txt" ]; then ok "the program in the repository folder was not started"; else bad "the program in the repository folder was started"; fi

    # (e) A workspace entry written with a backslash. The name of its cache file must be a plain
    # file name in the cache folder: the second run is then a cache hit. npm here is a .cmd of the
    # test, put first on PATH.
    newrepo "$S"
    mkdir -p "$S/packages/a" "$T/npmbin"
    echo '{ "name": "pkg-a", "scripts": { "check": "true" } }' >"$S/packages/a/package.json"
    printf "packages:\n  - 'packages\\\\a'\n" >"$S/pnpm-workspace.yaml"
    git -C "$S" add -A && git -C "$S" -c user.email=t@t -c user.name=t commit -q -m workspace
    printf '@exit /b 0\r\n' >"$T/npmbin/npm.cmd"
    npmfirst="$(cygpath -u "$T/npmbin"):$PATH"
    out="$(cd "$S" && PATH="$npmfirst" GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ] && [[ "$out" == *'[gate] зелено (fast): s/packages\a:check'* ]]; then ok "a workspace entry with a backslash: the script runs, green"
    else bad "a workspace entry with a backslash: rc=$rc, out: ${out:0:400}"; fi
    out="$(cd "$S" && PATH="$npmfirst" GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ] && [[ "$out" == *"(кэш)"* ]]; then ok "a workspace entry with a backslash: the second run is a cache hit"
    else bad "a workspace entry with a backslash: no cache hit (rc=$rc, out: ${out:0:400})"; fi
    if [ -n "$(find "$STATE/cache" -maxdepth 1 -type f -name 's__*__packages_a__fast__*')" ] && [ -z "$(find "$STATE/cache" -mindepth 1 -type d)" ]; then
        ok "the cache file of that entry is a plain file in the cache folder"
    else bad "cache folder: $(find "$STATE/cache" -mindepth 1 | tr '\n' ' ')"; fi

    # (f) The gate leaves the console it is started in alone: the script runs in a console of its
    # own, and only that one is switched to UTF-8. A .cmd stands for the window of a person who
    # runs the gate by hand: node gives it a console, it sets code page 437 there, runs the gate
    # and asks for the code page again. Only the number of an answer is read: `chcp` words it in
    # the language of the system.
    mode ok; touched
    printf '@echo off\r\nchcp 437 >nul\r\nchcp >"%%~dp0cp-before.txt"\r\nnode "%s" fast >"%%~dp0cp-gate.out" 2>&1\r\nchcp >"%%~dp0cp-after.txt"\r\n' "$GATE" >"$T/cp.cmd"
    GATE_SCOPE=all node -e '
        const path = require("node:path")
        const cmd = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe")
        const run = require("node:child_process").spawnSync(cmd, ["/d", "/c", path.win32.normalize(process.argv[1])], { cwd: process.argv[2], windowsHide: true, stdio: "ignore" })
        process.exit(run.status === 0 ? 0 : 1)' "$T/cp.cmd" "$R"
    page() { tr -cd '0-9' <"$T/cp-$1.txt" 2>/dev/null; }
    if [ "$(page before)" != 437 ]; then echo "skip the check of the console of the gate: it did not take code page 437 (it says: $(page before))"
    elif [[ "$(cat "$T/cp-gate.out" 2>/dev/null)" != *"[gate] зелено (fast): t/.:check"* ]] || [[ "$(cat "$T/cp-gate.out")" == *"(кэш)"* ]]; then
        bad "the console of the gate: the gate did not start the script (out: $(head -c 300 "$T/cp-gate.out" 2>/dev/null))"
    elif [ "$(page after)" = 437 ]; then ok "the console the gate was started in keeps its code page (437 before and after)"
    else bad "the gate changed the code page of the console it was started in: 437 before, $(page after) after"; fi

    # (g) What a .cmd writes to stderr comes between what it wrote to stdout before and after it:
    # the two streams are one inside the command line. And `!NAME!` in a .cmd stays as it is
    # written: the late expansion the gate uses for its own line does not reach the script.
    printf '@echo off\r\necho first to stdout\r\n1>&2 echo then to stderr\r\necho Tests 1 failed\r\necho late !OS! stays\r\nexit /b 1\r\n' >"$T/sp dir/argpm.cmd"
    echo 2 >"$A/n.txt"
    out="$(cd "$A" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    flat="$(printf '%s' "$out" | tr -d '\r' | tr '\n' '~')"
    if [ "$rc" -eq 2 ] && [[ "$flat" == *"first to stdout~then to stderr~Tests 1 failed"* ]]; then ok "stdout and stderr of a .cmd come in the order they were written, and its exit code makes the run red"
    else bad "the order of stdout and stderr: rc=$rc, out: ${out:0:400}"; fi
    if [[ "$out" == *'late !OS! stays'* ]]; then ok "!NAME! in a .cmd is not expanded by the gate"; else bad "!OS! was expanded: ${out:0:400}"; fi

    # (h) The gate waits for the script, not for what the script left behind. The .cmd starts a
    # process that lives for two minutes with the output of the script in its hands, and ends.
    # The process writes down its pid; it is stopped by that pid when the gate has returned.
    printf 'require("node:fs").writeFileSync(__dirname + "/left.pid", String(process.pid))\nsetTimeout(() => {}, 120000)\n' >"$T/sp dir/left.cjs"
    printf '@echo off\r\nstart "" /b node "%%~dp0left.cjs"\r\nexit /b 0\r\n' >"$T/sp dir/argpm.cmd"
    echo 3 >"$A/n.txt"
    began=$(date +%s)
    out="$(cd "$A" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    took=$(( $(date +%s) - began ))
    for _ in $(seq 1 50); do [ -s "$T/sp dir/left.pid" ] && break; sleep 0.1; done
    node -e 'try { process.kill(Number(require("node:fs").readFileSync(process.argv[1], "utf8"))) } catch {}' "$T/sp dir/left.pid"
    if [ "$rc" -eq 0 ] && [[ "$out" == *'[gate] зелено (fast): a/.:x&y'* ]] && [ "$took" -lt 60 ]; then ok "a process the script left behind does not hold the gate"
    else bad "a process left behind: rc=$rc, the gate took $took s (the process lives for 120), out: ${out:0:300}"; fi

    # (i) A command line longer than cmd.exe takes is not started: cut to nothing, it would end
    # with code 0 and count as green.
    newrepo "$X" "$LONG"
    mode ok
    echo 1 >"$X/n.txt"
    out="$(cd "$X" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    verdict "a command line too long for cmd.exe -> outcome unverified, exit 0, the script not started" "$X" \
        '.outcome == "unverified" and .exit == 0 and .key == "x" and (.reason | contains("cmd.exe cannot be given a command line of"))'
else
    echo "skip the cmd.exe checks (a real message of cmd.exe, ComSpec, words with a space and &, the current folder, a backslash in a workspace entry, the console of the gate, the order of stdout and stderr, a process left behind, a line too long): not Windows"
fi

# --- 4. The plan resolver crashed (the registry resolver works) -------------------------
cat >"$T/plan-crash.mjs" <<EOF
import { spawnSync } from "node:child_process"
if (process.argv[2] !== "--which") process.exit(5)
const r = spawnSync(process.execPath, [process.env.REAL_RESOLVE, ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(r.status ?? 1)
EOF
touched
out="$(cd "$R" && GATE_SCOPE=all REAL_RESOLVE="$REAL_RESOLVE" CLAUDE_GATE_RESOLVE="$T/plan-crash.mjs" node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "plan resolver crashed -> outcome unverified, exit 3, key t" "$R" '.outcome == "unverified" and .exit == 3 and .key == "t"'

# --- 5. The registry resolver crashed; the project is not registered -------------------
printf '#!/usr/bin/env node\nthrow new Error("boom")\n' >"$T/crash.mjs"
out="$(cd "$R" && CLAUDE_GATE_RESOLVE="$T/crash.mjs" node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "registry resolver crashed -> outcome unverified, exit 3, key null" "$R" '.outcome == "unverified" and .exit == 3 and .key == null'
out="$(cd "$U" && node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "not registered -> outcome unverified, exit 3, key null" "$U" '.outcome == "unverified" and .exit == 3 and .key == null and .profile == "fast"'

# --- 7. Nothing ran ------------------------------------------------------------------
out="$(cd "$Q" && node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "no changes from the merge-base -> outcome none, exit 0, key q" "$Q" '.outcome == "none" and .exit == 0 and .key == "q"'
out="$(cd "$Q" && GATE_SCOPE=all node "$GATE" full </dev/null 2>&1)"; rc=$?
verdict "no scripts of the profile -> outcome none, exit 0, profile full" "$Q" '.outcome == "none" and .exit == 0 and .profile == "full"'

# --- 8. A path with a space, quotes and a backslash ----------------------------------
out="$(cd "$W" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
f="$STATE/verdict-$(tag "$W").json"
if jq -e . "$f" >/dev/null 2>&1; then ok "odd path: jq -e . exits 0"; else bad "odd path: not valid JSON: $(head -c 300 "$f" 2>/dev/null)"; fi
if [ "$(jqr .worktree "$f" 2>/dev/null)" = "$W" ]; then ok "odd path: worktree equals the path"; else bad "odd path: worktree is $(jqr .worktree "$f" 2>/dev/null)"; fi
verdict "odd path -> outcome green, key w" "$W" '.outcome == "green" and .key == "w"'

# --- 9. A run that cannot write the file removes the previous one ------------------------
# A full disk: creating the temporary file fails. The gate still says red with code 2, and the
# green file of the run before must not stay to contradict it. The failure comes from a module
# node loads before the gate (NODE_OPTIONS), which refuses to create a file named .verdict-….
mode ok; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "before the failed write: a green file" "$R" '.outcome == "green"'
cat >"$T/full-disk.cjs" <<'EOF'
const fs = require("node:fs")
for (const name of ["writeFileSync", "openSync"]) {
    const real = fs[name]
    fs[name] = (file, ...rest) => {
        if (String(file).includes(".verdict-")) {
            throw Object.assign(new Error(`ENOSPC: no space left on device, ${name}`), { code: "ENOSPC" })
        }
        return real(file, ...rest)
    }
}
require("node:module").syncBuiltinESMExports()
EOF
mode bad; touched
out="$(cd "$R" && GATE_SCOPE=all NODE_OPTIONS="--require \"$T/full-disk.cjs\"" node "$GATE" fast </dev/null 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && [[ "$out" == *"[gate] красно (fast)"* ]]; then ok "failed write: the gate still says red, exit 2"
else bad "failed write: rc=$rc, out: ${out:0:300}"; fi
if [ ! -e "$STATE/verdict-$(tag "$R").json" ]; then ok "failed write: the previous green file is gone"
else bad "failed write: the file is left: $(head -c 300 "$STATE/verdict-$(tag "$R").json")"; fi
mode ok

# --- 9a. A reader holds the verdict file while the gate replaces it -----------------------
# worfy reads the file while the gate may be writing the next one. On Windows a file that is
# open cannot be replaced: the gate tries again for half a second. The reader here opens the file
# of the green run, waits until the temporary file of the next run appears, holds on for another
# 200 ms and lets go; the red verdict must be there afterwards. Elsewhere an open file does not
# stand in the way, and the check passes at once.
mode ok; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
cat >"$T/reader.cjs" <<'EOF'
const fs = require("node:fs")
const path = require("node:path")
const [file, ready, stop] = process.argv.slice(2)
const fd = fs.openSync(file, "r")
fs.writeFileSync(ready, "")
let letGo = false
const timer = setInterval(() => {
    if (fs.existsSync(stop)) {
        clearInterval(timer)
        if (!letGo) fs.closeSync(fd)
    } else if (!letGo && fs.readdirSync(path.dirname(file)).some((name) => name.startsWith(".verdict-"))) {
        letGo = true
        setTimeout(() => fs.closeSync(fd), 200)
    }
}, 10)
EOF
node "$T/reader.cjs" "$STATE/verdict-$(tag "$R").json" "$T/reader.ready" "$T/reader.stop" &
reader=$!
for _ in $(seq 1 100); do [ -e "$T/reader.ready" ] && break; sleep 0.1; done
mode bad; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
: >"$T/reader.stop"
wait "$reader"
if [ -e "$T/reader.ready" ]; then ok "the reader had the verdict file open"; else bad "the reader did not open the verdict file"; fi
verdict "a reader held the file -> the verdict of the new run is there: red, exit 2" "$R" '.outcome == "red" and .exit == 2'
mode ok

# --- 9b. A stopped run writes nothing down -----------------------------------------------
# A signal that ends a script (Ctrl-C reaches the children of the gate) is not a failed script,
# and a signal sent to the gate while it waits for a script must end the run before anything is
# written. In both cases: exit code 128 + the signal (SIGTERM is 15), no red marker, no verdict
# file — the one of the run before is removed. Not on Windows: a .cmd file cannot end by a
# signal, and SIGTERM there kills node without a word.
if [ "$WIN" -eq 1 ]; then echo "skip the signal checks: Windows has no SIGTERM for a .cmd file or for node"; else
    for how in term termparent; do
        mode ok; touched
        out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
        verdict "before the stopped run ($how): a green file" "$R" '.outcome == "green"'
        mode "$how"; touched
        out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
        if [ "$rc" -eq 143 ] && [ ! -e "$STATE/red-t-$(tag "$R")" ] && [ ! -e "$STATE/verdict-$(tag "$R").json" ] && [[ "$out" != *"[gate] красно"* && "$out" != *"[gate] зелено"* ]]; then
            ok "stopped run ($how): exit 143, no red marker, no verdict file, no verdict line"
        else
            bad "stopped run ($how): rc=$rc, red marker: $(ls "$STATE" | grep -c '^red-t-'), verdict: $(head -c 200 "$STATE/verdict-$(tag "$R").json" 2>/dev/null), out: ${out:0:300}"
        fi
    done
    mode ok
fi

# --- 9c. An error inside the gate is "could not verify", not a stack trace ---------------
# The error comes from a module node loads before the gate: the second SHA-1 the gate asks for
# (the first is the tag of the worktree) throws. Exit code 3, one line with the first line of
# the error, no verdict file.
mode ok; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "before the error inside the gate: a green file" "$R" '.outcome == "green"'
cat >"$T/boom.cjs" <<'EOF'
const crypto = require("node:crypto")
const real = crypto.createHash
let calls = 0
crypto.createHash = (...args) => {
    calls += 1
    if (calls > 1) throw new Error("boom of the test\nthe second line of the error")
    return real(...args)
}
require("node:module").syncBuiltinESMExports()
EOF
touched
out="$(cd "$R" && GATE_SCOPE=all NODE_OPTIONS="--require \"$T/boom.cjs\"" node "$GATE" fast </dev/null 2>&1)"; rc=$?
if [ "$rc" -eq 3 ] && [[ "$out" == *"[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: boom of the test"* ]] && [[ "$out" != *"the second line of the error"* ]] && [[ "$out" != *"    at "* ]]; then
    ok "an error inside the gate: exit 3 and one «ПРОВЕРИТЬ НЕ УДАЛОСЬ» line, no stack trace"
else bad "an error inside the gate: rc=$rc, out: ${out:0:400}"; fi
if [ ! -e "$STATE/verdict-$(tag "$R").json" ]; then ok "an error inside the gate: no verdict file"
else bad "an error inside the gate: the file is left: $(head -c 300 "$STATE/verdict-$(tag "$R").json")"; fi

# --- 9d. The current folder was deleted -------------------------------------------------
# Not a git folder any more: exit 0 and silence, as outside git. Windows does not let a folder
# be deleted while a process stands in it.
if [ "$WIN" -eq 1 ]; then echo "skip the deleted folder check: Windows keeps the current folder of a process"; else
    mkdir -p "$T/gone"
    out="$(cd "$T/gone" && rmdir "$T/gone" && node "$GATE" fast </dev/null 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ] && [ -z "$out" ]; then ok "the current folder was deleted -> exit 0, no output"
    else bad "the current folder was deleted: rc=$rc, out: ${out:0:300}"; fi
fi

# --- 10. Outside git: no file -------------------------------------------------------------
mkdir -p "$T/nogit" "$T/state-nogit"
out="$(cd "$T/nogit" && CLAUDE_GATE_STATE="$T/state-nogit" node "$GATE" fast </dev/null 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -z "$(find "$T/state-nogit" -name 'verdict-*')" ]; then ok "outside git -> exit 0, no verdict file"
else bad "outside git: rc=$rc, files: $(find "$T/state-nogit" -name 'verdict-*')"; fi

# --- 11. No temporary files of the gate are left ---------------------------------------
left="$(find "$STATE" -maxdepth 1 -type f ! -name 'verdict-*.json' ! -name 'red-*' ! -name 'unverified-*' ! -name 'nokey-*')"
if [ -z "$left" ]; then ok "no temporary files in the state folder"; else bad "left in the state folder: $left"; fi

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
