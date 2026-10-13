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
# sh) or envbad-cmd (the same in the words of cmd.exe). On Windows the file is a .cmd: node starts
# nothing else there without an interpreter.
if [ "$WIN" -eq 1 ]; then
    PM="$T/fakepm.cmd"
    cat >"$PM" <<'EOF'
@echo off
set /p m=<"%~dp0mode"
if "%m%"=="ok" exit /b 0
if "%m%"=="bad" (echo Tests 1 failed& exit /b 1)
if "%m%"=="envbad" (echo sh: tool: command not found& exit /b 127)
if "%m%"=="envbad-cmd" (echo 'tool' is not recognized as an internal or external command,& exit /b 1)
exit /b 1
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
jq -n --arg r "$R" --arg q "$Q" --arg w "$W" --arg m "$M" --arg p "$P" --arg pm "$PM" '{repos: [
    {key: "t", match: $r, pm: $pm, root: {fast: ["check"], full: ["check"]}, workspace: {}},
    {key: "q", match: $q, pm: $pm, root: {fast: ["check"]}, workspace: {}},
    {key: "w", match: $w, pm: $pm, root: {fast: ["check"]}, workspace: {}},
    {key: "m", match: $m, pm: "worfy-no-such-package-manager", root: {fast: ["check"]}, workspace: {}},
    {key: "p", match: $p, pm: $pm, root: {fast: ["a%b"]}, workspace: {}}
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
mode ok; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "a later green run overwrites red with green" "$R" '.outcome == "green" and .exit == 0 and .profile == "fast"'

# --- 3. Environment unavailable ------------------------------------------------------
mode envbad; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "environment unavailable -> outcome unverified, exit 0, a reason" "$R" '.outcome == "unverified" and .exit == 0 and .key == "t"'
# cmd.exe names a missing tool in its own words; the text is the same sign on every system.
mode envbad-cmd; touched
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "environment unavailable in the words of cmd.exe -> outcome unverified, exit 0" "$R" \
    '.outcome == "unverified" and .exit == 0 and (.reason | contains("is not recognized as an internal or external command"))'
if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ — окружение недоступно:"* ]]; then ok "the words of cmd.exe: exit 0 and the «окружение недоступно» line"
else bad "the words of cmd.exe: rc=$rc, out: ${out:0:300}"; fi
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
