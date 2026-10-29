# The world of the gate verdict tests, sourced after `set -u` by gate-verdict.test.sh,
# gate-verdict-signals.test.sh and gate-verdict-inside.test.sh: the temporary folder, ok/bad, the
# verdict check, the stand-in package manager, the fixture repositories and their registry, and
# finish, which checks that no temporary file of the gate is left and prints the count. Not a test
# of its own (no .test.sh). The three files were one, which took 106 s on the macOS runner and was
# cut off at the 120 s limit of a shell test in test/harness-scripts-suite.ts.
#
# The registry, the state folder and the repositories are temporary (CLAUDE_GATE_CONFIG,
# CLAUDE_GATE_STATE): the test does not touch the live registry or markers.
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
# sh) or envbad-cmd (the same in the words of cmd.exe); second-bad fails in the script named
# "second" only. term and kill9 end the script by a signal of its own (SIGTERM, SIGKILL), and
# termparent sends SIGTERM to the gate and ends well. wait0 and wait1 write the name of the script
# to $T/started and wait for SIGTERM or SIGINT, on which they end with code 0 or 1; left alone
# they end with code 7 after ten seconds. logok and logbad write the name down and pass or fail;
# hold waits as hold.pl below says. On Windows the file is a .cmd: node starts nothing else there
# without an interpreter, and a .cmd knows no signals.
if [ "$WIN" -eq 1 ]; then
    PM="$T/fakepm.cmd"
    cat >"$PM" <<'EOF'
@echo off
set /p m=<"%~dp0mode"
if "%m%"=="ok" exit /b 0
if "%m%"=="bad" (echo Tests 1 failed& exit /b 1)
if "%m%"=="second-bad" (if "%~2"=="second" (echo Tests 1 failed& exit /b 1) else (exit /b 0))
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
    second-bad) [ "\$2" = second ] || exit 0; echo "Tests 1 failed"; exit 1 ;;
    term) kill -TERM \$\$; sleep 5 ;;
    kill9) echo "said before the kill"; kill -9 \$\$; sleep 5 ;;
    termparent) kill -TERM \$PPID; exit 0 ;;
    wait0) trap 'exit 0' TERM INT; echo "\$2" >>"$T/started"; i=0; while [ \$i -lt 10 ]; do sleep 1; i=\$((i + 1)); done; exit 7 ;;
    wait1) trap 'exit 1' TERM INT; echo "\$2" >>"$T/started"; i=0; while [ \$i -lt 10 ]; do sleep 1; i=\$((i + 1)); done; exit 7 ;;
    logok) echo "\$2" >>"$T/started"; exit 0 ;;
    logbad) echo "\$2" >>"$T/started"; echo "Tests 1 failed"; exit 1 ;;
    hold) exec perl "$T/hold.pl" "$T/in-slow" "$T/go" ;;
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
D="$T/two"          # registered, key "d": a profile of two scripts, check and second
K="$T/pkgs"         # registered, key "k": a script of the root and one of the package packages/a
N="$T/nostart"      # registered, key "n": its package manager is a file that cannot be started
for r in "$R" "$Q" "$U" "$W" "$M" "$D" "$K" "$N"; do newrepo "$r"; done
newrepo "$P" 'a%b'
# The resolver reads the scripts and the workspaces from the files as they are now, committed or not.
echo '{ "name": "fixture", "scripts": { "check": "true", "second": "true" } }' >"$D/package.json"
echo '{ "name": "fixture", "scripts": { "check": "true" }, "workspaces": ["packages/a"] }' >"$K/package.json"
mkdir -p "$K/packages/a"
echo '{ "name": "pkg-a", "scripts": { "check": "true" } }' >"$K/packages/a/package.json"
# A file the system cannot start: without the execute bit, and on Windows an .exe that is no
# program (the gate starts an .exe itself when cmd.exe cannot be given a word of the line — here
# the percent sign of the script name).
if [ "$WIN" -eq 1 ]; then NOSTART="$T/nostart.exe"; NOSTART_SCRIPT='a%b'; else NOSTART="$T/nostart-pm"; NOSTART_SCRIPT=check; fi
printf '#!/bin/sh\nexit 0\n' >"$NOSTART"
chmod a-x "$NOSTART"
[ "$WIN" -eq 1 ] && echo '{ "name": "fixture", "scripts": { "a%b": "true" } }' >"$N/package.json"
# Only Windows runs the next five (cmd.exe and the names of Windows); their registry entries
# stand on every system and are simply never used elsewhere.
C="$T/cmdmsg"       # key "c": its package manager is a .cmd that calls a tool that does not exist
A="$T/args"         # key "a": a package manager in a folder with a space, a script name with `&`
L="$T/local"        # key "l": a package manager that lies only in the repository folder
S="$T/slash"        # key "s": a workspace entry written with a backslash
X="$T/long"         # key "x": a script name that makes the command line longer than cmd.exe takes
LONG="$(printf 'a%.0s' $(seq 1 8100))"
jq -n --arg r "$R" --arg q "$Q" --arg w "$W" --arg m "$M" --arg p "$P" --arg pm "$PM" \
    --arg c "$C" --arg cpm "$T/realpm.cmd" --arg a "$A" --arg apm "$T/sp dir/argpm.cmd" --arg l "$L" --arg s "$S" --arg x "$X" --arg long "$LONG" \
    --arg d "$D" --arg k "$K" --arg n "$N" --arg npm "$NOSTART" --arg nscript "$NOSTART_SCRIPT" '{repos: [
    {key: "t", match: $r, pm: $pm, root: {fast: ["check"], full: ["check"]}, workspace: {}},
    {key: "d", match: $d, pm: $pm, root: {fast: ["check", "second"]}, workspace: {}},
    {key: "k", match: $k, pm: $pm, root: {fast: ["check"]}, workspace: {fast: ["check"]}},
    {key: "n", match: $n, pm: $npm, root: {fast: [$nscript]}, workspace: {}},
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

# A PATH whose `npm` is a file of the test that fails, for the script of packages/a in $K.
mkdir -p "$T/npmbad"
if [ "$WIN" -eq 1 ]; then
    printf '@echo off\r\necho Tests 1 failed\r\nexit /b 1\r\n' >"$T/npmbad/npm.cmd"
    npmbad="$(cygpath -u "$T/npmbad"):$PATH"
else
    printf '#!/bin/sh\necho "Tests 1 failed"\nexit 1\n' >"$T/npmbad/npm"
    chmod +x "$T/npmbad/npm"
    npmbad="$T/npmbad:$PATH"
fi

# The names and the content of the cache files: a stopped run must leave them as they were.
cachesum() { (cd "$STATE/cache" && ls && cat ./* 2>/dev/null) | cksum; }

# The end of each file: no temporary files of the gate are left in the state folder, then the count.
finish() {
    local left
    left="$(find "$STATE" -maxdepth 1 -type f ! -name 'verdict-*.json' ! -name 'red-*' ! -name 'unverified-*' ! -name 'nokey-*')"
    if [ -z "$left" ]; then ok "no temporary files in the state folder"; else bad "left in the state folder: $left"; fi
    echo "passed $pass, failed $fail"
    [ "$fail" -eq 0 ]
}
