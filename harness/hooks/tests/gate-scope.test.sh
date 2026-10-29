#!/usr/bin/env bash
# Tests of the paths that narrow the gate's scope to the changed packages (changedPaths in gate.mjs):
#   - a file moved from workspace packages/a to workspace packages/b, staged and then committed on the
#     branch: both packages are in the scope, the one the file left as well as the one it went to;
#   - a workspace whose folder name has a space, and one whose name has a double quote (not on
#     Windows, where a file name cannot hold one): a file changed in it puts that workspace in scope;
#   - a new untracked file in a workspace puts that workspace in scope;
#   - a workspace whose folder name starts with a space: a file changed in it puts that workspace in
#     scope (the gate hands the paths to gate-resolve.mjs NUL-separated, and nothing trims them);
#   - a changed path with a line break in it stays one path: its own workspace is in scope, and the
#     piece after the break neither adds another workspace nor counts as a file outside workspaces
#     (not on Windows, where a file name cannot hold a line break);
#   - a file name that ends with a space is not taken for the name without it: root_if, which asks
#     for names ending in .ts, does not match it, and such a file in a workspace keeps that workspace
#     in scope (not on Windows, which drops a trailing space);
#   - a workspace whose folder name has a tab, and one whose name has a line break, each get their
#     own scope: the gate runs that package's script and names the folder escaped, in quotes, on
#     one line (gate-resolve.mjs prints the plan as JSON, which keeps such a name whole), and the
#     warning about changes outside workspaces names such a file the same way (not on Windows,
#     where a file name cannot hold a tab or a line break);
#   - a plan the gate cannot read (the old tab-separated form) is "not verified", exit 3, not green.
# Run: bash harness/hooks/tests/gate-scope.test.sh; exit code 0 means everything passed.
# HOOKS_DIR runs the test on another copy of the hooks (for example, on the version before an edit).
#
# The registry, the state folder and the repositories are temporary (CLAUDE_GATE_CONFIG,
# CLAUDE_GATE_STATE): the test does not touch the live registry or markers.
set -u
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads.
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
HOOKS="${HOOKS_DIR:-$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })}"   # the hooks next to this test (harness/hooks)
GATE="$HOOKS/gate.mjs"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
unset CLAUDE_CODE_SESSION_ID GATE_SCOPE HARNESS_HOME GATE_MAX_AHEAD GATE_MAX_BEHIND
T="$(mktemp -d)" || exit 1
[ -d "$T" ] || exit 1
T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
export CLAUDE_GATE_STATE="$T/state" CLAUDE_GATE_CONFIG="$T/config.json"
mkdir -p "$T/state"
# A second guard besides the fake npm below: should a real npm ever run, its cache is inside the
# test's own folder, never the user's ~/.npm.
export npm_config_cache="$T/npm-cache"

# The registry entries have workspace scripts only, which the gate runs as
# "npm run <script> --workspace <package>" (pm "npm"). The npm first in PATH is this file: every
# script passes, and the test starts no real npm. On Windows it is a .cmd: node starts nothing
# else there without an interpreter, and PATH takes the /c/… spelling.
mkdir -p "$T/npm"
if [ "$WIN" -eq 1 ]; then
    printf '@echo off\r\nexit /b 0\r\n' >"$T/npm/npm.cmd"
    export PATH="$(cygpath -u "$T/npm"):$PATH"
else
    # It also writes down its arguments, one call per line: which package the gate ran.
    cat >"$T/npm/npm" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >>"$T/npm.log"
exit 0
EOF
    chmod +x "$T/npm/npm"
    export PATH="$T/npm:$PATH"
fi

commit() { git -C "$1" add -A && git -C "$1" -c user.email=t@t -c user.name=t commit -q -m "$2"; }
# $1 = repository, the rest = workspace folders: a package with a "check" script in each, one file
# in each, committed; origin/main is that commit, and the branch "work" starts there.
newrepo() {
    local repo="$1" dir list=""
    shift
    mkdir -p "$repo"
    git -C "$repo" init -q -b main
    for dir in "$@"; do
        mkdir -p "$repo/$dir"
        printf '{ "name": "pkg-%s", "scripts": { "check": "true" } }\n' "$(printf '%s' "${dir##*/}" | tr -c 'a-z' 'x')" >"$repo/$dir/package.json"
        printf 'export const value = "%s"\n' "$dir" | tr -d '"' >"$repo/$dir/mod.ts"
        list="$list${list:+, }$(jq -n --arg d "$dir" '$d')"
    done
    echo "{ \"name\": \"fixture\", \"workspaces\": [$list] }" >"$repo/package.json"
    commit "$repo" base
    git -C "$repo" update-ref refs/remotes/origin/main HEAD
    git -C "$repo" checkout -q -b work
}
# Sets `scope`, the gate's «[gate] scope» line, and `out`, `rc`.
gate() {
    out="$(cd "$1" && node "$GATE" fast </dev/null 2>&1)"; rc=$?
    scope="$(printf '%s\n' "$out" | grep '^\[gate\] scope (fast)' | tr -d '\r')"
}
# $1 = description, the rest = the workspace folders the scope line must list after its «—».
scoped() {
    local what="$1" dir missing=""
    shift
    for dir in "$@"; do
        [[ "${scope#*—}" == *" $dir"* ]] || missing="$missing $dir"
    done
    if [ "$rc" -eq 0 ] && [[ "$scope" == *"narrowed by the diff"* ]] && [ -z "$missing" ]; then ok "$what"
    else bad "$what (missing:${missing:- none}; rc=$rc, out: ${out:0:600})"; fi
}

M="$T/move"       # key "m": two workspaces, a file moves from one to the other
S="$T/space"      # key "s": a workspace whose folder name has a space
Q="$T/quote"      # key "q": a workspace whose folder name has a double quote
U="$T/untracked"  # key "u": a new file that git does not track yet
L="$T/lead"       # key "l": a workspace whose folder name starts with a space
N="$T/newline"    # key "n": a changed path with a line break in it
E="$T/edge"       # key "e": a file name that ends with a space, and root scripts limited by root_if
P="$T/trail"      # key "t": a file name that ends with a space, in a workspace
X="$T/tab"        # key "x": a workspace whose folder name has a tab
Y="$T/break"      # key "y": a workspace whose folder name has a line break
newrepo "$M" packages/a packages/b
newrepo "$S" "packages/my pkg" packages/b
[ "$WIN" -eq 1 ] || newrepo "$Q" 'packages/q"t' packages/b
newrepo "$U" packages/a packages/b
newrepo "$L" " lead" packages/b
[ "$WIN" -eq 1 ] || newrepo "$N" packages/a packages/b
[ "$WIN" -eq 1 ] || newrepo "$P" packages/a packages/b
[ "$WIN" -eq 1 ] || newrepo "$X" "packages/a"$'\t'"tab" packages/b
[ "$WIN" -eq 1 ] || newrepo "$Y" "packages/a"$'\n'"break" packages/b
if [ "$WIN" -ne 1 ]; then
    # The root of «edge» has a "check" script of its own, which root_if limits to names ending in .ts.
    newrepo "$E" packages/a
    jq '. + {scripts: {check: "true"}}' "$E/package.json" >"$T/edge-root.json" && mv "$T/edge-root.json" "$E/package.json"
    git -C "$E" -c user.email=t@t -c user.name=t commit -q -a --amend --no-edit
    git -C "$E" update-ref refs/remotes/origin/main HEAD
fi
jq -n --arg m "$M" --arg s "$S" --arg q "$Q" --arg u "$U" --arg l "$L" --arg n "$N" --arg e "$E" --arg p "$P" --arg x "$X" --arg y "$Y" '{repos: [
    {key: "m", match: $m, pm: "npm", root: {}, workspace: {fast: ["check"]}},
    {key: "s", match: $s, pm: "npm", root: {}, workspace: {fast: ["check"]}},
    {key: "q", match: $q, pm: "npm", root: {}, workspace: {fast: ["check"]}},
    {key: "u", match: $u, pm: "npm", root: {}, workspace: {fast: ["check"]}},
    {key: "l", match: $l, pm: "npm", root: {}, workspace: {fast: ["check"]}},
    {key: "n", match: $n, pm: "npm", root: {}, workspace: {fast: ["check"]}},
    {key: "t", match: $p, pm: "npm", root: {}, workspace: {fast: ["check"]}},
    {key: "x", match: $x, pm: "npm", root: {}, workspace: {fast: ["check"]}},
    {key: "y", match: $y, pm: "npm", root: {}, workspace: {fast: ["check"]}},
    {key: "e", match: $e, pm: "npm", root: {fast: ["check"]}, root_if: "\\.ts$", workspace: {}}
]}' >"$CLAUDE_GATE_CONFIG"

# --- 1. A file moved between two workspaces, staged ------------------------------------------
# The content is the same, so git takes the pair for a rename unless told otherwise.
git -C "$M" mv packages/a/mod.ts packages/b/moved.ts
gate "$M"
scoped "a staged move from packages/a to packages/b: both packages in the scope" packages/a packages/b

# --- 2. The same move, committed on the branch, the worktree clean ---------------------------
git -C "$M" -c user.email=t@t -c user.name=t commit -q -m move
if [ -z "$(git -C "$M" status --porcelain)" ]; then
    gate "$M"
    scoped "a committed move from packages/a to packages/b: both packages in the scope" packages/a packages/b
else
    bad "the move did not commit: $(git -C "$M" status --porcelain | tr '\n' ' ')"
fi

# --- 3. A path with a space, which git status quotes without -z --------------------------------
echo 'export const more = 1' >>"$S/packages/my pkg/mod.ts"
gate "$S"
scoped "an edit in «packages/my pkg»: that package in the scope" "packages/my pkg"
if [[ "${scope#*—}" != *" packages/b"* ]]; then ok "an edit in «packages/my pkg»: packages/b stays out of the scope"
else bad "an edit in «packages/my pkg» put packages/b in the scope: $scope"; fi

# --- 4. A path with a double quote, which git escapes inside the quotes without -z -------------
if [ "$WIN" -eq 1 ]; then
    echo "skip a path with a double quote: Windows file names cannot hold one"
else
    echo 'export const more = 1' >>"$Q/packages/q\"t/mod.ts"
    gate "$Q"
    scoped 'an edit in «packages/q"t»: that package in the scope' 'packages/q"t'
fi

# --- 5. A new untracked file ------------------------------------------------------------------
echo 'export const added = 1' >"$U/packages/b/added.ts"
gate "$U"
scoped "a new untracked file in packages/b: that package in the scope" packages/b
if [[ "${scope#*—}" != *" packages/a"* ]]; then ok "a new untracked file in packages/b: packages/a stays out of the scope"
else bad "a new untracked file in packages/b put packages/a in the scope: $scope"; fi

# --- 6. A workspace whose folder name starts with a space -------------------------------------
# Trimmed, the path « lead/mod.ts» becomes «lead/mod.ts», which lies in no workspace, and the scope
# loses the package that changed.
echo 'export const more = 1' >>"$L/ lead/mod.ts"
gate "$L"
scoped "an edit in « lead»: that package in the scope" " lead"
if [[ "${scope#*—}" != *" packages/b"* ]]; then ok "an edit in « lead»: packages/b stays out of the scope"
else bad "an edit in « lead» put packages/b in the scope: $scope"; fi

# --- 7. A changed path with a line break in it ---------------------------------------------------
# The file is «packages/a/x<line break>packages/b». Untracked, git status names its new folder,
# «packages/a/x<line break>packages/»: split by lines, the piece «packages/» lies in no workspace.
# Staged or committed, git names the file itself: split by lines, the piece «packages/b» is the folder
# of another workspace.
if [ "$WIN" -eq 1 ]; then
    echo "skip a path with a line break: Windows file names cannot hold one"
else
    mkdir -p "$N/packages/a/x"$'\n'"packages"
    echo 'export const added = 1' >"$N/packages/a/x"$'\n'"packages/b"
    gate "$N"
    scoped "a new untracked folder whose path has a line break, in packages/a: that package in the scope" packages/a
    if [[ "$out" != *"changes outside workspaces"* ]]; then ok "an untracked path with a line break: no piece of it counts as a file outside workspaces"
    else bad "an untracked path with a line break left a piece outside workspaces: ${out:0:600}"; fi
    # Staged: git status lists the full file path.
    git -C "$N" add -A
    gate "$N"
    scoped "a staged path with a line break, in packages/a: that package in the scope" packages/a
    if [[ "${scope#*—}" != *" packages/b"* ]]; then ok "a staged path with a line break: the piece after the break does not put packages/b in the scope"
    else bad "a staged path with a line break put packages/b in the scope: $scope"; fi
    # The same path, committed on the branch: it now comes from the diff against the merge-base.
    commit "$N" "a path with a line break"
    gate "$N"
    scoped "a committed path with a line break, in packages/a: that package in the scope" packages/a
    if [[ "${scope#*—}" != *" packages/b"* ]]; then ok "a committed path with a line break: packages/b stays out of the scope"
    else bad "a committed path with a line break put packages/b in the scope: $scope"; fi
fi

# --- 8. A file name that ends with a space ---------------------------------------------------------
# root_if asks for names ending in «.ts». «notes.ts » does not end so; trimmed, it would, and the root
# scripts would run for a file they do not look at.
if [ "$WIN" -eq 1 ]; then
    echo "skip a file name that ends with a space: Windows drops a trailing space from file names"
else
    echo 'not a source file' >"$E/notes.ts "
    gate "$E"
    if [ "$rc" -eq 0 ] && [[ "$scope" == *"narrowed by the diff"*"— none."* ]] && [[ "$out" == *"[gate] nothing ran (fast): the changes touch no checked package"* ]]; then
        ok "a new file «notes.ts »: root_if does not match it, and no root script runs"
    else bad "a new file «notes.ts » ran the root scripts (rc=$rc, out: ${out:0:600})"; fi
    # Kept, not dropped: the same kind of name inside a workspace puts that workspace in scope.
    echo 'export const added = 1' >"$P/packages/a/mod.ts "
    gate "$P"
    scoped "a new file «packages/a/mod.ts »: packages/a in the scope" packages/a
    if [[ "${scope#*—}" != *" packages/b"* ]]; then ok "a new file «packages/a/mod.ts »: packages/b stays out of the scope"
    else bad "a new file «packages/a/mod.ts » put packages/b in the scope: $scope"; fi
fi

# --- 9. A workspace whose folder name has a tab or a line break ------------------------------------
# The plan used to be tab-separated lines: the tab split «packages/a<tab>tab» into a folder
# «packages/a» and a package «tab», and the line break split the plan line in two. Each such workspace
# must get its own scope: its own script runs (npm.log), and the gate names the folder escaped, in
# quotes, on the scope line.
if [ "$WIN" -eq 1 ]; then
    echo "skip folder names with a tab or a line break: Windows file names cannot hold them"
else
    # $1 = key, $2 = repository, $3 = workspace folder, $4 = its package, $5 = the folder as the gate names it
    own_scope() {
        local key="$1" repo="$2" dir="$3" pkg="$4" shown="$5"
        : >"$T/npm.log"
        echo 'export const more = 1' >>"$repo/$dir/mod.ts"
        gate "$repo"
        scoped "an edit in the folder $shown: that package in the scope, named escaped" "$shown"
        if [[ "${scope#*—}" != *" packages/b"* ]]; then ok "an edit in the folder $shown: packages/b stays out of the scope"
        else bad "an edit in the folder $shown put packages/b in the scope: $scope"; fi
        if grep -qxF "run check --workspace $pkg" "$T/npm.log" && [ "$(wc -l <"$T/npm.log" | tr -d ' ')" = 1 ]; then
            ok "an edit in the folder $shown: the gate runs the script of $pkg and nothing else"
        else bad "an edit in the folder $shown: npm calls: $(tr '\n' ';' <"$T/npm.log"), out: ${out:0:600}"; fi
        if printf '%s\n' "$out" | grep -qxF "[gate] green (fast): $key/$shown:check"; then
            ok "an edit in the folder $shown: the green line names it escaped, on one line"
        else bad "an edit in the folder $shown: no one-line green line: ${out:0:600}"; fi
    }
    own_scope x "$X" "packages/a"$'\t'"tab" pkg-axtab '"packages/a\ttab"'
    own_scope y "$Y" "packages/a"$'\n'"break" pkg-axbreak '"packages/a\nbreak"'
    # A file outside workspaces whose name has a tab or a line break: the warning names it in quotes,
    # escaped, on one line.
    printf 'notes\n' >"$X/top"$'\t'"tab.md"
    printf 'notes\n' >"$X/top"$'\n'"break.md"
    gate "$X"
    warn="$(printf '%s\n' "$out" | grep '^\[gate\] x: changes outside workspaces')"
    if [[ "$warn" == *'"top\ttab.md"'* && "$warn" == *'"top\nbreak.md"'* ]]; then
        ok "files outside workspaces with a tab or a line break: the warning names them escaped, in quotes, on one line"
    else bad "the warning about files outside workspaces: «$warn», out: ${out:0:600}"; fi
fi

# --- 10. A plan the gate cannot read -----------------------------------------------------------------
# A resolver that prints the old tab-separated plan (an old copy of the hooks), or JSON of another
# shape (scripts as one string): the gate must not read either as a plan, and says "not verified",
# exit 3.
# $1 = description, $2 = the plan line the fake resolver prints (a JavaScript expression)
unreadable() {
    cat >"$T/bad-plan.mjs" <<EOF
import { spawnSync } from "node:child_process"
if (process.argv[2] !== "--which") {
    console.log($2)
    process.exit(0)
}
const r = spawnSync(process.execPath, [process.env.REAL_RESOLVE, ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(r.status ?? 1)
EOF
    out="$(cd "$U" && REAL_RESOLVE="$CLAUDE_GATE_RESOLVE" CLAUDE_GATE_RESOLVE="$T/bad-plan.mjs" node "$GATE" fast </dev/null 2>&1)"; rc=$?
    if [ "$rc" -eq 3 ] && [[ "$out" == *"[gate] not verified: the plan resolver gate-resolve.mjs printed a plan the gate cannot read"* ]] && [[ "$out" != *"[gate] green"* ]]; then
        ok "$1: not verified, exit 3"
    else bad "$1: rc=$rc, out: ${out:0:600}"; fi
}
echo 'export const more = 1' >>"$U/packages/b/mod.ts"
unreadable "a tab-separated plan" '["packages/b", "pkg-b", "check", "packages/b", ""].join("\t")'
unreadable "a JSON plan whose scripts are one string" 'JSON.stringify({ dir: "packages/b", name: "pkg-b", scripts: "check" })'

echo
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
