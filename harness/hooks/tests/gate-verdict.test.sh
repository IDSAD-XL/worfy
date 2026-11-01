#!/usr/bin/env bash
# Tests of the gate's verdict file: every run of gate.mjs in a git
# worktree leaves verdict-<tag>.json in the gate state folder, next to the markers, with the
# outcome of that run in English keys and values. A directory outside git leaves no file.
#   - each path of gate.mjs: green (a fresh run and a cache hit), red, environment unavailable
#     (the message of sh and the one of cmd.exe, a package manager that is not installed), the
#     registry resolver crashed, not registered, the plan resolver crashed, nothing ran;
#   - what must not turn green: a red run repeated with no change, the second script of a
#     profile and the second package of the plan failing, a package manager that cannot be
#     started, an edit of a tracked file after a green run;
#   - an error inside the gate leaves the nokey-broken marker that stop.mjs reads;
#   - node not found: the answer is the one of the launcher gate.sh;
#   - a worktree path with a space, a quote and a backslash still gives a parseable file;
#   - a second run overwrites the file; no temporary files are left in the state folder;
#   - the verdict lines are English: «[gate] green (…)» («(cache)» on a hit), «[gate] red (…): … (passed: …)»,
#     «[gate] nothing ran (…)», «[gate] not verified: …» and «[gate] not verified — environment unavailable:».
# Signals to a running gate: gate-verdict-signals.test.sh; the same moments made inside the gate
# process: gate-verdict-inside.test.sh. The world of the three: gate-verdict-world.sh.
# Run: bash harness/hooks/tests/gate-verdict.test.sh; exit code 0 means everything passed.
# HOOKS_DIR runs the test on another copy of the hooks (for example, on the version before an edit).
set -u
. "$(cd "$(dirname "$0")" && pwd)/gate-verdict-world.sh"

# --- 1. Green: a fresh run, then a cache hit ----------------------------------------
mode ok; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "green run -> outcome green, exit 0, profile fast, key t, head" "$R" \
    '.outcome == "green" and .exit == 0 and .profile == "fast" and .key == "t" and .head == $head' --arg head "$HEAD_R"
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] green (fast): t/.:check"*" (cache)"* ]]; then ok "second green run is a cache hit: the «[gate] green (fast): … (cache)» line"; else bad "cache hit expected (rc=$rc, out: ${out:0:200})"; fi
verdict "green from cache -> outcome green, exit 0" "$R" '.outcome == "green" and .exit == 0 and .key == "t"'
# The green of the cache is the green of that content. `touched` adds a file git does not track;
# here a tracked file is edited, and the script must run again.
echo '{ "name": "fixture", "scripts": { "check": "true" }, "edited": true }' >"$R/package.json"
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] green (fast): t/.:check"* ]] && [[ "$out" != *"(cache)"* ]]; then ok "an edit of a tracked file misses the cache: the script runs again"
else bad "an edit of a tracked file: a fresh run expected (rc=$rc, out: ${out:0:300})"; fi
git -C "$R" checkout -q -- package.json

# --- 2. Red; a second run overwrites the file -----------------------------------------
mode bad; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" full </dev/null 2>&1)"; rc=$?
verdict "red run (full) -> outcome red, exit 2, profile full" "$R" '.outcome == "red" and .exit == 2 and .profile == "full" and .key == "t"'
# The red marker is what the Stop hook stop.mjs holds a turn on: a red run leaves it, a green run removes it.
if [ -s "$STATE/red-t-$(tag "$R")" ]; then ok "red run leaves the red marker of the worktree"; else bad "red run: no red marker (state: $(ls "$STATE" | tr '\n' ' '))"; fi
# Only green is cached: the same content checked again is run again, and is red again.
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" full </dev/null 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && [[ "$out" == *"[gate] red (full): t/.:check"* ]]; then ok "a red run repeated with no change is red again, not a cache hit"
else bad "a red run repeated with no change: rc=$rc, out: ${out:0:300}"; fi
verdict "a red run repeated with no change -> outcome red, exit 2" "$R" '.outcome == "red" and .exit == 2 and .profile == "full"'
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

# --- 2a. Red in the second script, in the second package, from a file that cannot be started --
# Every script of a package is run, not only the first one.
mode second-bad
echo 1 >"$D/n.txt"
out="$(cd "$D" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "a profile of two scripts, the second fails -> outcome red, exit 2" "$D" '.outcome == "red" and .exit == 2 and .key == "d"'
if [ "$rc" -eq 2 ] && [[ "$out" == *"[gate] red (fast): d/.:second (passed: d/.:check)"* ]]; then ok "two scripts: the line names the second as failed and the first as passed"
else bad "two scripts: rc=$rc, out: ${out:0:300}"; fi
mode ok
# Every package of the plan is run, not only the first one. The root script goes through the
# package manager of the registry and passes; the script of packages/a goes through `npm`, which
# here is a file of the test, first on PATH, that fails ($npmbad, gate-verdict-world.sh).
out="$(cd "$K" && PATH="$npmbad" GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "two packages in the plan, the second fails -> outcome red, exit 2" "$K" '.outcome == "red" and .exit == 2 and .key == "k"'
if [ "$rc" -eq 2 ] && [[ "$out" == *"[gate] red (fast): k/packages/a:check (passed: k/.:check)"* ]]; then ok "two packages: the line names the second as failed and the first as passed"
else bad "two packages: rc=$rc, out: ${out:0:300}"; fi
# The run is red, and still the package whose scripts all passed is green for its content: its
# cache entry is written, the failed package gets none.
k_cache="$(cd "$STATE/cache" && ls | grep "^k__$(tag "$K")__" | tr '\n' ' ')"
if [[ "$k_cache" == "k__$(tag "$K")__.__fast__"*" " ]] && [[ "$k_cache" != *"__packages_a__"* ]]; then ok "two packages, the second fails: the root that passed is cached, packages/a is not"
else bad "two packages, the second fails: cache entries of k: ${k_cache:-none}"; fi
# The next run with an npm that passes: the root comes from the cache, packages/a runs. The green line
# names the scripts that ran and, after them, the ones the cache answered for.
mkdir -p "$T/npmok"
if [ "$WIN" -eq 1 ]; then
    printf '@echo off\r\nexit /b 0\r\n' >"$T/npmok/npm.cmd"
    npmok="$(cygpath -u "$T/npmok"):$PATH"
else
    printf '#!/bin/sh\nexit 0\n' >"$T/npmok/npm"
    chmod +x "$T/npmok/npm"
    npmok="$T/npmok:$PATH"
fi
out="$(cd "$K" && PATH="$npmok" GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] green (fast): k/packages/a:check (cache: k/.:check)"* ]]; then ok "one package from the cache, one run: the «[gate] green (fast): … (cache: …)» line"
else bad "one package from the cache, one run: rc=$rc, out: ${out:0:300}"; fi
# A package manager that is there but cannot be started has checked nothing: that is not a
# script that passed.
echo 1 >"$N/n.txt"
out="$(cd "$N" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "a package manager that cannot be started -> outcome red, exit 2" "$N" '.outcome == "red" and .exit == 2 and .key == "n"'
if [ "$rc" -eq 2 ] && [[ "$out" != *"[gate] green"* ]]; then ok "a package manager that cannot be started: exit 2, no green line"
else bad "a package manager that cannot be started: rc=$rc, out: ${out:0:300}"; fi

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
if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] not verified — environment unavailable:"* && "$out" == *"This is not a green result."* && "$out" != *"[gate] green"* ]]; then
    ok "environment unavailable: exit 0 and the English «[gate] not verified — environment unavailable:» line"
else bad "environment unavailable: the «not verified — environment unavailable» line expected (rc=$rc, out: ${out:0:300})"; fi
# cmd.exe names a missing tool in its own words. They are a sign of a missing environment on
# Windows only: elsewhere no shell says them, and a failed script that prints them has failed.
mode envbad-cmd; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
if [ "$WIN" -eq 1 ]; then
    verdict "environment unavailable in the words of cmd.exe -> outcome unverified, exit 0" "$R" \
        '.outcome == "unverified" and .exit == 0 and (.reason | contains("is not recognized as an internal or external command"))'
    if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] not verified — environment unavailable:"* ]]; then ok "the words of cmd.exe: exit 0 and the «environment unavailable» line"
    else bad "the words of cmd.exe: rc=$rc, out: ${out:0:300}"; fi
else
    verdict "the words of cmd.exe off Windows are the output of a failed script -> outcome red, exit 2" "$R" '.outcome == "red" and .exit == 2 and .key == "t"'
    if [ "$rc" -eq 2 ] && [[ "$out" == *"[gate] red (fast): t/.:check"* ]]; then ok "the words of cmd.exe off Windows: exit 2 and the «red» line"
    else bad "the words of cmd.exe off Windows: rc=$rc, out: ${out:0:300}"; fi
fi
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
    if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] not verified — environment unavailable:"* ]]; then ok "cmd.exe itself names a missing tool: exit 0 and the «environment unavailable» line"
    else bad "cmd.exe itself names a missing tool: rc=$rc, out: ${out:0:400}"; fi

    # (b) ComSpec may name another shell (PowerShell): the gate starts cmd.exe of the system anyway.
    mode ok; touched
    out="$(cd "$R" && COMSPEC=powershell.exe GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] green (fast): t/.:check"* ]]; then ok "ComSpec names PowerShell: the script still runs, green"
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
    if [ "$rc" -eq 0 ] && [[ "$out" == *'[gate] green (fast): s/packages\a:check'* ]]; then ok "a workspace entry with a backslash: the script runs, green"
    else bad "a workspace entry with a backslash: rc=$rc, out: ${out:0:400}"; fi
    out="$(cd "$S" && PATH="$npmfirst" GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ] && [[ "$out" == *"(cache)"* ]]; then ok "a workspace entry with a backslash: the second run is a cache hit"
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
    elif [[ "$(cat "$T/cp-gate.out" 2>/dev/null)" != *"[gate] green (fast): t/.:check"* ]] || [[ "$(cat "$T/cp-gate.out")" == *"(cache)"* ]]; then
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
    if [ "$rc" -eq 0 ] && [[ "$out" == *'[gate] green (fast): a/.:x&y'* ]] && [ "$took" -lt 60 ]; then ok "a process the script left behind does not hold the gate"
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
# A resolver that exits with a code is named by that code: in the line, the reason and the marker.
verdict "plan resolver crashed -> the reason names its exit code" "$R" '.reason == "the plan resolver gate-resolve.mjs exited with code 5"'
if [ "$rc" -eq 3 ] && [[ "$out" == *"[gate] not verified: the plan resolver gate-resolve.mjs exited with code 5 — "* ]] \
    && grep -qF "Could not verify: the plan resolver exited with code 5." "$STATE/unverified-t-$(tag "$R")" 2>/dev/null; then
    ok "plan resolver crashed: exit 3, the line and the unverified marker name exit code 5"
else bad "plan resolver crashed: rc=$rc, marker: $(head -c 200 "$STATE/unverified-t-$(tag "$R")" 2>/dev/null), out: ${out:0:300}"; fi

# --- 5. The registry resolver crashed; the project is not registered -------------------
printf '#!/usr/bin/env node\nthrow new Error("boom")\n' >"$T/crash.mjs"
out="$(cd "$R" && CLAUDE_GATE_RESOLVE="$T/crash.mjs" node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "registry resolver crashed -> outcome unverified, exit 3, key null" "$R" '.outcome == "unverified" and .exit == 3 and .key == null'
verdict "registry resolver crashed -> the reason names exit code 1, then the first line of its stderr" "$R" '.reason | startswith("the registry resolver gate-resolve.mjs exited with code 1: ")'
if [ "$rc" -eq 3 ] && [[ "$out" == *"[gate] not verified: the registry resolver gate-resolve.mjs exited with code 1"* ]]; then ok "registry resolver crashed: exit 3, the line names exit code 1"
else bad "registry resolver crashed: rc=$rc, out: ${out:0:300}"; fi
out="$(cd "$U" && node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "not registered -> outcome unverified, exit 3, key null" "$U" '.outcome == "unverified" and .exit == 3 and .key == null and .profile == "fast"'

# --- 6. node not found ------------------------------------------------------------------
# gate.mjs cannot say that: the launcher gate.sh does, and it writes the same file. PATH here has
# git and the tools gate.sh needs, and no node: the folders of Git Bash on Windows, elsewhere a
# folder of links to the tools. gate.sh looks for node in /opt/homebrew/bin and /usr/local/bin
# itself: with node there a copy of gate.sh that does not look there runs, as in gate-shim.test.sh.
NONODE="" why="" LAUNCHER="$HOOKS/gate.sh"
if [ -x /opt/homebrew/bin/node ] || [ -x /usr/local/bin/node ]; then
    LAUNCHER="$T/gate-no-usual-node.sh"
    # Each folder on its own, whatever the order of the list (eval-env.test.sh says why).
    sed 's#/opt/homebrew/bin#/worfy-test-no-such-folder-a#g; s#/usr/local/bin#/worfy-test-no-such-folder-b#g' "$HOOKS/gate.sh" >"$LAUNCHER"
    grep -qE '/opt/homebrew/bin|/usr/local/bin' "$LAUNCHER" && bad "the copy of gate.sh still looks in /opt/homebrew/bin or /usr/local/bin"
fi
if [ "$WIN" -eq 1 ]; then NONODE="/usr/bin:$(dirname "$(command -v git)")"
else
    mkdir -p "$T/bin"
    for t in bash env git sha1sum shasum mkdir mktemp date mv rm cat sort; do
        p="$(command -v "$t" 2>/dev/null)" && [ "${p#/}" != "$p" ] && ln -sf "$p" "$T/bin/$t"
    done
    NONODE="$T/bin"
fi
if [ -n "$NONODE" ] && (PATH="$NONODE"; command -v node >/dev/null 2>&1); then why="node is in $NONODE, next to git and the shell tools"; NONODE=""; fi
if [ -n "$NONODE" ] && ! (PATH="$NONODE"; command -v git >/dev/null 2>&1); then
    # Git Bash always has git, so a skip here would hide a wrong NONODE.
    [ "$WIN" -eq 1 ] && bad "git is not in $NONODE"
    why="git is not in $NONODE"; NONODE=""
fi
if [ -z "$NONODE" ]; then echo "skip the node-missing check: $why"; else
    mode ok; touched
    out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    verdict "before the run without node: a green file" "$R" '.outcome == "green"'
    mkdir -p "$T/home"   # no ~/.nvm in it: gate.sh looks for node there too
    out="$(cd "$R" && HOME="$T/home" USERPROFILE="$T/home" PATH="$NONODE" "$BASH" "$LAUNCHER" fast </dev/null 2>&1)"; rc=$?
    verdict "node not found -> outcome unverified, exit 3, key null, in place of the green file" "$R" \
        '.outcome == "unverified" and .exit == 3 and .key == null and .profile == "fast" and .reason == "node not found" and .head == $head' --arg head "$HEAD_R"
    if [ "$rc" -eq 3 ] && [[ "$out" == *"[gate] not verified: node not found"* ]] && grep -q "node not found" "$STATE/nokey-broken-$(tag "$R")-anon" 2>/dev/null; then ok "node not found: exit 3, the «node not found» line and the marker of the worktree"
    else bad "node not found: rc=$rc, out: ${out:0:300}, state: $(ls "$STATE" | tr '\n' ' ')"; fi
fi

# --- 7. Nothing ran ------------------------------------------------------------------
out="$(cd "$Q" && node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "no changes from the merge-base -> outcome none, exit 0, key q" "$Q" '.outcome == "none" and .exit == 0 and .key == "q"'
if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] nothing ran (fast): no changes relative to the merge-base "*" with "*". This is not green."* ]]; then ok "no changes: exit 0 and the English «[gate] nothing ran (fast)» line"
else bad "no changes: the «nothing ran» line expected (rc=$rc, out: ${out:0:300})"; fi
# The registry names no script of the profile full for q: the resolver plans no package.
out="$(cd "$Q" && GATE_SCOPE=all node "$GATE" full </dev/null 2>&1)"; rc=$?
verdict "a profile with no script for the repository -> outcome none, exit 0, profile full" "$Q" '.outcome == "none" and .exit == 0 and .profile == "full"'
if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] nothing ran (full): the changes touch no checked package. This is not green."* ]]; then ok "no package in the plan: exit 0 and the English «[gate] nothing ran (full): the changes touch no checked package» line"
else bad "no package in the plan: the «nothing ran» line expected (rc=$rc, out: ${out:0:300})"; fi
# A package in the plan with no script of the profile (a resolver that gives the root with an empty list of
# scripts): the gate checks nothing and says so.
cat >"$T/plan-noscripts.mjs" <<EOF
import { spawnSync } from "node:child_process"
if (process.argv[2] !== "--which") { console.log(JSON.stringify({ dir: ".", name: "", scripts: [] })); process.exit(0) }
const r = spawnSync(process.execPath, [process.env.REAL_RESOLVE, ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(r.status ?? 1)
EOF
out="$(cd "$Q" && GATE_SCOPE=all REAL_RESOLVE="$REAL_RESOLVE" CLAUDE_GATE_RESOLVE="$T/plan-noscripts.mjs" node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "a package with no script of the profile -> outcome none, exit 0, the reason says so" "$Q" \
    '.outcome == "none" and .exit == 0 and .reason == "the selected packages have no scripts of the profile"'
if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] nothing ran (fast): the selected packages have no scripts of the profile. This is not green."* ]]; then ok "a package with no script of the profile: exit 0 and the English «[gate] nothing ran (fast)» line"
else bad "a package with no script of the profile: the «nothing ran» line expected (rc=$rc, out: ${out:0:300})"; fi

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
if [ "$rc" -eq 2 ] && [[ "$out" == *"[gate] red (fast)"* ]]; then ok "failed write: the gate still says red, exit 2"
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
if [ "$rc" -eq 3 ] && [[ "$out" == *"[gate] not verified: boom of the test"* ]] && [[ "$out" != *"the second line of the error"* ]] && [[ "$out" != *"    at "* ]]; then
    ok "an error inside the gate: exit 3 and one «not verified» line, no stack trace"
else bad "an error inside the gate: rc=$rc, out: ${out:0:400}"; fi
if [ ! -e "$STATE/verdict-$(tag "$R").json" ]; then ok "an error inside the gate: no verdict file"
else bad "an error inside the gate: the file is left: $(head -c 300 "$STATE/verdict-$(tag "$R").json")"; fi
# stop.mjs tells the model about "could not verify" only through a marker.
if [ "$(tr -d '\r' <"$STATE/nokey-broken-$(tag "$R")-anon" 2>/dev/null)" = "boom of the test. The gate itself failed and checked nothing — this is not green." ]; then
    ok "an error inside the gate: the nokey-broken marker of the worktree, with the first line of the error"
else bad "an error inside the gate: marker: $(head -c 300 "$STATE/nokey-broken-$(tag "$R")-anon" 2>/dev/null)"; fi
# A green run in the same tree and session takes that marker away: stop.mjs must not tell the
# model "not verified" after the gate has checked the work. The marker of another session stays.
echo "of another session" >"$STATE/nokey-broken-$(tag "$R")-other"
touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] green"* ]] && [ ! -e "$STATE/nokey-broken-$(tag "$R")-anon" ] && [ -s "$STATE/nokey-broken-$(tag "$R")-other" ]; then
    ok "a green run after an error inside the gate: the nokey-broken marker of its session is gone, another session's stays"
else bad "a green run after an error inside the gate: rc=$rc, markers: $(ls "$STATE" | grep "^nokey-broken-$(tag "$R")" | tr '\n' ' '), out: ${out:0:200}"; fi
rm -f "$STATE/nokey-broken-$(tag "$R")-anon" "$STATE/nokey-broken-$(tag "$R")-other"


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
finish
