#!/usr/bin/env bash
# Tests of the gate's verdict file (ticket worfy-harness/09): every run of gate.sh in a git
# worktree leaves verdict-<tag>.json in the gate state folder, next to the markers, with the
# outcome of that run in English keys and values. A directory outside git leaves no file.
#   - each path of gate.sh: green (a fresh run and a cache hit), red, environment unavailable,
#     node not found, the registry resolver crashed, not registered, the plan resolver crashed,
#     nothing ran;
#   - a worktree path with a space, a quote and a backslash still gives a parseable file;
#   - a second run overwrites the file; no temporary files are left in the state folder.
# Run: bash harness/hooks/tests/gate-verdict.test.sh; exit code 0 means everything passed.
# HOOKS_DIR runs the test on another copy of the hooks (for example, on the version before an edit).
#
# The registry, the state folder and the repositories are temporary (CLAUDE_GATE_CONFIG,
# CLAUDE_GATE_STATE): the test does not touch the live registry or markers.
set -u
HOOKS="${HOOKS_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"   # the hooks next to this test (harness/hooks)
GATE="$HOOKS/gate.sh"
REAL_RESOLVE="$HOOKS/gate-resolve.mjs"
export CLAUDE_GATE_RESOLVE="$REAL_RESOLVE"
unset CLAUDE_CODE_SESSION_ID GATE_SCOPE HARNESS_HOME
T="$(mktemp -d)" || exit 1
[ -d "$T" ] || exit 1
T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
tag() { printf '%s' "$1" | shasum | awk '{print $1}' | cut -c1-8; }
STATE="$T/state"
export CLAUDE_GATE_STATE="$STATE" CLAUDE_GATE_CONFIG="$T/config.json"
mkdir -p "$STATE" "$T/home"

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
# does is set by $T/mode: ok, bad (a real test failure) or envbad (a missing tool).
PM="$T/fakepm"
cat >"$PM" <<EOF
#!/bin/sh
case "\$(cat "$T/mode")" in
    ok) exit 0 ;;
    bad) echo "Tests 1 failed"; exit 1 ;;
    envbad) echo "sh: tool: command not found"; exit 127 ;;
esac
exit 1
EOF
chmod +x "$PM"
mode() { echo "$1" >"$T/mode"; }

newrepo() { # $1 = path: a repository with one commit and origin/main at it
    mkdir -p "$1"
    git -C "$1" init -q -b main
    echo '{ "name": "fixture", "scripts": { "check": "true" } }' >"$1/package.json"
    git -C "$1" add package.json
    git -C "$1" -c user.email=t@t -c user.name=t commit -q -m init
    git -C "$1" update-ref refs/remotes/origin/main HEAD
}
R="$T/reg"          # registered, key "t"
Q="$T/quiet"        # registered, key "q": profile fast only
U="$T/unreg"        # not registered
W="$T/sp ace\"quo\\te'x"   # registered, key "w": a path with a space, quotes and a backslash
for r in "$R" "$Q" "$U" "$W"; do newrepo "$r"; done
jq -n --arg r "$R" --arg q "$Q" --arg w "$W" --arg pm "$PM" '{repos: [
    {key: "t", match: $r, pm: $pm, root: {fast: ["check"], full: ["check"]}, workspace: {}},
    {key: "q", match: $q, pm: $pm, root: {fast: ["check"]}, workspace: {}},
    {key: "w", match: $w, pm: $pm, root: {fast: ["check"]}, workspace: {}}
]}' >"$CLAUDE_GATE_CONFIG"
HEAD_R="$(git -C "$R" rev-parse HEAD)"
n=0
touched() { n=$((n + 1)); echo "$n" >"$R/n.txt"; }   # changes the content, so the green cache misses

# --- 1. Green: a fresh run, then a cache hit ----------------------------------------
mode ok; touched
out="$(cd "$R" && GATE_SCOPE=all bash "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "green run -> outcome green, exit 0, profile fast, key t, head" "$R" \
    '.outcome == "green" and .exit == 0 and .profile == "fast" and .key == "t" and .head == $head' --arg head "$HEAD_R"
out="$(cd "$R" && GATE_SCOPE=all bash "$GATE" fast </dev/null 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [[ "$out" == *"(кэш)"* ]]; then ok "second green run is a cache hit"; else bad "cache hit expected (rc=$rc, out: ${out:0:200})"; fi
verdict "green from cache -> outcome green, exit 0" "$R" '.outcome == "green" and .exit == 0 and .key == "t"'

# --- 2. Red; a second run overwrites the file -----------------------------------------
mode bad; touched
out="$(cd "$R" && GATE_SCOPE=all bash "$GATE" full </dev/null 2>&1)"; rc=$?
verdict "red run (full) -> outcome red, exit 2, profile full" "$R" '.outcome == "red" and .exit == 2 and .profile == "full" and .key == "t"'
mode ok; touched
out="$(cd "$R" && GATE_SCOPE=all bash "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "a later green run overwrites red with green" "$R" '.outcome == "green" and .exit == 0 and .profile == "fast"'

# --- 3. Environment unavailable ------------------------------------------------------
mode envbad; touched
out="$(cd "$R" && GATE_SCOPE=all bash "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "environment unavailable -> outcome unverified, exit 0, a reason" "$R" '.outcome == "unverified" and .exit == 0 and .key == "t"'
mode ok

# --- 4. The plan resolver crashed (the registry resolver works) -------------------------
cat >"$T/plan-crash.mjs" <<EOF
import { spawnSync } from "node:child_process"
if (process.argv[2] !== "--which") process.exit(5)
const r = spawnSync(process.execPath, [process.env.REAL_RESOLVE, ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(r.status ?? 1)
EOF
touched
out="$(cd "$R" && GATE_SCOPE=all REAL_RESOLVE="$REAL_RESOLVE" CLAUDE_GATE_RESOLVE="$T/plan-crash.mjs" bash "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "plan resolver crashed -> outcome unverified, exit 3, key t" "$R" '.outcome == "unverified" and .exit == 3 and .key == "t"'

# --- 5. The registry resolver crashed; the project is not registered -------------------
printf '#!/usr/bin/env node\nthrow new Error("boom")\n' >"$T/crash.mjs"
out="$(cd "$R" && CLAUDE_GATE_RESOLVE="$T/crash.mjs" bash "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "registry resolver crashed -> outcome unverified, exit 3, key null" "$R" '.outcome == "unverified" and .exit == 3 and .key == null'
out="$(cd "$U" && bash "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "not registered -> outcome unverified, exit 3, key null" "$U" '.outcome == "unverified" and .exit == 3 and .key == null and .profile == "fast"'

# --- 6. node not found ------------------------------------------------------------------
# gate.sh adds /opt/homebrew/bin itself: if node is there, "no node" cannot be simulated. PATH
# is a folder with links to the tools the gate needs before it looks for node, and no node.
if [ -x /opt/homebrew/bin/node ]; then echo "skip node-missing check: /opt/homebrew/bin/node exists"; else
    mkdir -p "$T/bin"
    for t in bash git shasum awk cut find head rm mv mkdir mktemp date dirname realpath cat sed tr wc sort printf; do
        p="$(command -v "$t" 2>/dev/null)" && [ "${p#/}" != "$p" ] && ln -sf "$p" "$T/bin/$t"
    done
    out="$(cd "$R" && HOME="$T/home" PATH="$T/bin" bash "$GATE" fast </dev/null 2>&1)"; rc=$?
    verdict "node not found -> outcome unverified, exit 3, key null" "$R" '.outcome == "unverified" and .exit == 3 and .key == null'
fi

# --- 7. Nothing ran ------------------------------------------------------------------
out="$(cd "$Q" && bash "$GATE" fast </dev/null 2>&1)"; rc=$?
verdict "no changes from the merge-base -> outcome none, exit 0, key q" "$Q" '.outcome == "none" and .exit == 0 and .key == "q"'
out="$(cd "$Q" && GATE_SCOPE=all bash "$GATE" full </dev/null 2>&1)"; rc=$?
verdict "no scripts of the profile -> outcome none, exit 0, profile full" "$Q" '.outcome == "none" and .exit == 0 and .profile == "full"'

# --- 8. A path with a space, quotes and a backslash ----------------------------------
out="$(cd "$W" && GATE_SCOPE=all bash "$GATE" fast </dev/null 2>&1)"; rc=$?
f="$STATE/verdict-$(tag "$W").json"
if jq -e . "$f" >/dev/null 2>&1; then ok "odd path: jq -e . exits 0"; else bad "odd path: not valid JSON: $(head -c 300 "$f" 2>/dev/null)"; fi
if [ "$(jq -r .worktree "$f" 2>/dev/null)" = "$W" ]; then ok "odd path: worktree equals the path"; else bad "odd path: worktree is $(jq -r .worktree "$f" 2>/dev/null)"; fi
verdict "odd path -> outcome green, key w" "$W" '.outcome == "green" and .key == "w"'

# --- 9. Outside git: no file -------------------------------------------------------------
mkdir -p "$T/nogit" "$T/state-nogit"
out="$(cd "$T/nogit" && CLAUDE_GATE_STATE="$T/state-nogit" bash "$GATE" fast </dev/null 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -z "$(find "$T/state-nogit" -name 'verdict-*')" ]; then ok "outside git -> exit 0, no verdict file"
else bad "outside git: rc=$rc, files: $(find "$T/state-nogit" -name 'verdict-*')"; fi

# --- 10. No temporary files of the gate are left ---------------------------------------
left="$(find "$STATE" -maxdepth 1 -type f ! -name 'verdict-*.json' ! -name 'red-*' ! -name 'unverified-*' ! -name 'nokey-*')"
if [ -z "$left" ]; then ok "no temporary files in the state folder"; else bad "left in the state folder: $left"; fi

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
