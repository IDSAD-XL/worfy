#!/usr/bin/env bash
# Tests of gate.sh, the launcher of the gate under its old name (worfy-windows ticket 03).
#   - with node on PATH it adds nothing of its own: one run through `node gate.mjs` and one through
#     `bash gate.sh` give the same exit code, the same "[gate] …" lines and the same files in the
#     state folder — green, red and not registered; the profile argument (fast, full) and stdin
#     (the session of the hook JSON in the name of the marker) reach the gate;
#   - it finds gate.mjs through a symlink to itself (not on Windows: Git Bash copies a file
#     instead of linking it);
#   - node is not on PATH but under ~/.nvm: the launcher finds it, and the gate runs;
#   - which node it picks: /opt/homebrew/bin before /usr/local/bin before nvm; the newest version
#     of nvm by number (v24 before v9); a node that is too old is passed over, on PATH or in nvm;
#   - no node anywhere: the «node не найден» line, exit code 3, the marker and an "unverified"
#     verdict file in place of the one of the run before — through the hook command of
#     hooks.json, after a green run; outside git it is silent and exits with 0; when the verdict
#     file cannot be put in place, the file of the run before is removed;
#   - its bash lines name the state folder and the worktree tag as gate-paths.mjs does: for a
#     path with a space, one with Cyrillic letters and one reached through a symlink;
#   - git has the file as executable: hooks.json starts it by its path.
# Run: bash harness/hooks/tests/gate-shim.test.sh; exit code 0 means everything passed.
# HOOKS_DIR runs the test on another copy of the hooks.
#
# The registry, the state folders and the repositories are temporary (CLAUDE_GATE_CONFIG,
# CLAUDE_GATE_STATE, HARNESS_HOME, HOME): the test does not touch the live registry or markers.
set -u
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads.
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
TESTS="$(cd "$(dirname "$0")" && pwd)"
HOOKS="${HOOKS_DIR:-$(cd "$TESTS/.." && { pwd -W 2>/dev/null || pwd; })}"   # the hooks next to this test (harness/hooks)
GATE="$HOOKS/gate.mjs"
SHIM="$HOOKS/gate.sh"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
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
export CLAUDE_GATE_CONFIG="$T/config.json"
mkdir -p "$T/state-new" "$T/state-old" "$T/none" "$T/home"

# --- fixtures ---------------------------------------------------------------------
# The gate runs "$PM run <script>"; pm is this file, so the test needs no npm. $T/mode says how
# the script ends: ok or bad (a real test failure). On Windows the file is a .cmd: node starts
# nothing else there without an interpreter.
if [ "$WIN" -eq 1 ]; then
    PM="$T/fakepm.cmd"
    printf '@echo off\r\nset /p m=<"%%~dp0mode"\r\nif "%%m%%"=="ok" exit /b 0\r\necho Tests 1 failed\r\nexit /b 1\r\n' >"$PM"
else
    PM="$T/fakepm"
    printf '#!/bin/sh\n[ "$(cat "%s/mode")" = ok ] && exit 0\necho "Tests 1 failed"\nexit 1\n' "$T" >"$PM"
    chmod +x "$PM"
fi
mode() { echo "$1" >"$T/mode"; }
newrepo() { # $1 = path: a repository with one commit and origin/main at it
    mkdir -p "$1"
    git -C "$1" init -q -b main
    echo '{ "name": "fixture", "scripts": { "check": "true" } }' >"$1/package.json"
    git -C "$1" add package.json
    git -C "$1" -c user.email=t@t -c user.name=t commit -q -m init
    git -C "$1" update-ref refs/remotes/origin/main HEAD
}
R="$T/reg"      # registered, key "t"
U="$T/unreg"    # not registered
newrepo "$R"; newrepo "$U"
jq -n --arg r "$R" --arg pm "$PM" '{repos: [{key: "t", match: $r, pm: $pm, root: {fast: ["check"], full: ["check"]}, workspace: {}}]}' >"$CLAUDE_GATE_CONFIG"

# both <stdin> <repository> <arguments…>: the same run by the new name and by the old one. Each
# has a state folder of its own, so the second run is no cache hit of the first.
both() {
    local input="$1" repo="$2"; shift 2
    out_new="$(cd "$repo" && printf '%s' "$input" | CLAUDE_GATE_STATE="$T/state-new" GATE_SCOPE=all node "$GATE" "$@" 2>&1)"; rc_new=$?
    out_old="$(cd "$repo" && printf '%s' "$input" | CLAUDE_GATE_STATE="$T/state-old" GATE_SCOPE=all bash "$SHIM" "$@" 2>&1)"; rc_old=$?
}
gate_lines() { printf '%s\n' "$1" | tr -d '\r' | grep '^\[gate\]'; }
# same <description> <exit code> <a "[gate]" line both must print>
same() {
    if [ "$rc_new" -eq "$2" ] && [ "$rc_old" -eq "$2" ] && [ "$(gate_lines "$out_new")" = "$(gate_lines "$out_old")" ] && [[ "$out_old" == *"$3"* ]]; then ok "$1"
    else bad "$1 (gate.mjs: rc=$rc_new, out: ${out_new:0:200}; gate.sh: rc=$rc_old, out: ${out_old:0:200})"; fi
}

# --- 1. The same answer by both names ------------------------------------------------
mode ok
both "" "$R" fast
same "green: exit 0 and the same lines by both names" 0 "[gate] зелено (fast): t/.:check"
mode bad
both "" "$R" full
same "red, and the profile argument is passed on: exit 2 and «красно (full)» by both names" 2 "[gate] красно (full): t/.:check"
mode ok
both '{"session_id":"shim session/1"}' "$U" fast
same "not registered: exit 3 and the same lines by both names" 3 "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ"

# --- 2. stdin is passed on, and the state folder is left the same ---------------------
if [ -n "$(find "$T/state-old" -maxdepth 1 -type f -name 'nokey-*-shim_session_1')" ]; then ok "stdin reaches the gate: the marker carries the session of the hook JSON"
else bad "no marker of the session in the state folder: $(ls "$T/state-old")"; fi
if [ "$(ls "$T/state-new")" = "$(ls "$T/state-old")" ] && [ -n "$(ls "$T/state-old")" ]; then ok "the files of the state folder have the same names by both names"
else bad "state folders differ: gate.mjs: $(ls "$T/state-new" | tr '\n' ' '); gate.sh: $(ls "$T/state-old" | tr '\n' ' ')"; fi

# --- 3. Through a symlink ----------------------------------------------------------
if [ "$WIN" -eq 1 ]; then
    echo "skip the symlink check: Git Bash on Windows copies a file instead of linking it"
    # Git Bash turns /c/… into C:/… for a Windows program unless told not to; the file must give
    # node a path it reads either way.
    out="$(cd "$R" && MSYS_NO_PATHCONV=1 CLAUDE_GATE_STATE="$T/state-old" GATE_SCOPE=all bash "$SHIM" fast </dev/null 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] зелено (fast): t/.:check"* ]]; then ok "with path conversion of Git Bash off: gate.mjs is still found"
    else bad "with path conversion off: rc=$rc, out: ${out:0:300}"; fi
else
    ln -s "$SHIM" "$T/old-gate.sh"
    out="$(cd "$R" && CLAUDE_GATE_STATE="$T/state-old" GATE_SCOPE=all bash "$T/old-gate.sh" fast </dev/null 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] зелено (fast): t/.:check"* ]]; then ok "through a symlink to gate.sh: gate.mjs is found next to the real file"
    else bad "through a symlink: rc=$rc, out: ${out:0:300}"; fi
fi

# --- 4. git has the file as executable ---------------------------------------------
# hooks.json starts gate.sh by its path, with no `bash` in front: without the execute bit the
# hook does not start at all. The mode in the index is what a checkout on any system gets.
index_line="$(git -C "$TESTS/.." ls-files -s -- gate.sh 2>/dev/null)"
if [ -z "$index_line" ]; then echo "skip the execute bit check: $TESTS/../gate.sh is not a file of a git checkout"
elif [ "${index_line%% *}" = 100755 ]; then ok "git has gate.sh with mode 100755"
else bad "gate.sh in git: $index_line (mode 100755 expected)"; fi

# --- the launcher where node is not on PATH --------------------------------------------
# NONODE is a PATH with git and the tools the launcher and the script of the test need, and no
# node: what a hook gets where node is not installed. Git Bash keeps the tools in /usr/bin and
# git in /mingw64/bin; elsewhere a folder of links to the tools is made.
NONODE="" why=""
if [ "$WIN" -eq 1 ]; then NONODE="/usr/bin:/mingw64/bin"
else
    mkdir -p "$T/bin"
    for t in bash env git sha1sum shasum mkdir mktemp date mv rm cat dirname realpath sort; do
        p="$(command -v "$t" 2>/dev/null)" && [ "${p#/}" != "$p" ] && ln -sf "$p" "$T/bin/$t"
    done
    NONODE="$T/bin"
fi
if (PATH="$NONODE"; command -v node >/dev/null 2>&1); then why="node is in $NONODE, next to git and the shell tools"; NONODE=""; fi
if [ -n "$NONODE" ] && ! (PATH="$NONODE"; command -v git >/dev/null 2>&1); then why="git is not in $NONODE"; NONODE=""; fi
# PLUGIN is a copy of the gate laid out as the plugin is, hooks/ under a root: the hook command
# of hooks.json is run on it. Its gate.sh is the file under test as it is — unless node is
# installed in /opt/homebrew/bin or /usr/local/bin. The launcher looks there itself, so "no node"
# cannot be shown with those folders: the copy then names two folders that do not exist in their
# place, and nothing else in it differs.
PLUGIN="$T/plugin"
LAUNCHER="$PLUGIN/hooks/gate.sh"
mkdir -p "$PLUGIN/hooks"
cp "$GATE" "$HOOKS/gate-paths.mjs" "$HOOKS/gate-resolve.mjs" "$HOOKS/eval-env.cjs" "$PLUGIN/hooks/"
if [ -x /opt/homebrew/bin/node ] || [ -x /usr/local/bin/node ]; then
    echo "note: node is in /opt/homebrew/bin or /usr/local/bin: the checks below run a copy of gate.sh that does not look there"
    sed 's#/opt/homebrew/bin /usr/local/bin#/worfy-test-no-such-folder-a /worfy-test-no-such-folder-b#' "$SHIM" >"$LAUNCHER"
    if [ -n "$NONODE" ] && ! grep -q '/worfy-test-no-such-folder-a /worfy-test-no-such-folder-b' "$LAUNCHER"; then
        why="gate.sh no longer names /opt/homebrew/bin and /usr/local/bin in one line: the test cannot take them out"; NONODE=""
    fi
else
    cp "$SHIM" "$LAUNCHER"
fi
chmod +x "$LAUNCHER"
# The hook command as hooks.json has it: of the copy under test, else of the hooks next to this test.
HJ="$HOOKS/hooks.json"
[ -f "$HJ" ] || HJ="$TESTS/../hooks.json"
hook="$(jqr '.hooks.TaskCompleted[0].hooks[0].command' "$HJ")"
if [ "$hook" = "$(jqr '.hooks.TeammateIdle[0].hooks[0].command' "$HJ")" ] && [ -n "$hook" ]; then ok "hooks.json: TaskCompleted and TeammateIdle run the same command"
else bad "hooks.json: the two gate hooks differ or are missing: $hook"; fi

if [ -z "$NONODE" ]; then echo "skip the checks of the launcher without node on PATH: $why"; else
    # --- 5. Node only under ~/.nvm ------------------------------------------------------
    # A "node" under the home folder of the test: it leaves a file to show it was the one
    # started, and runs the real node.
    nvm="$T/home-nvm/.nvm/versions/node/v0.0.1/bin"
    mkdir -p "$nvm" "$T/state-nvm"
    printf '#!/bin/sh\necho used >"%s/used"\nexec "%s" "$@"\n' "$T/home-nvm" "$(command -v node)" >"$nvm/node"
    chmod +x "$nvm/node"
    mode ok
    out="$(cd "$R" && HOME="$T/home-nvm" USERPROFILE="$T/home-nvm" CLAUDE_GATE_STATE="$T/state-nvm" GATE_SCOPE=all PATH="$NONODE" "$BASH" "$LAUNCHER" fast </dev/null 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] зелено (fast): t/.:check"* ]] && [ -e "$T/home-nvm/used" ]; then ok "node not on PATH but under ~/.nvm: the launcher finds it, and the gate runs"
    else bad "node under ~/.nvm: rc=$rc, the node of the test was $([ -e "$T/home-nvm/used" ] && echo used || echo "not used"), out: ${out:0:300}"; fi

    # --- 6. No node anywhere: the hook command after a green run --------------------------
    # A green run; then an edit that makes the script fail; then the hook, on a PATH without
    # node. The verdict file must not say green any more.
    mkdir -p "$T/state-hook"
    verdict_file="$T/state-hook/verdict-$(tag "$R").json"
    mode ok
    out="$(cd "$R" && CLAUDE_GATE_STATE="$T/state-hook" GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    if [ "$(jqr .outcome "$verdict_file" 2>/dev/null)" = green ]; then ok "before the hook without node: the verdict file says green"
    else bad "before the hook without node: rc=$rc, file: $(head -c 300 "$verdict_file" 2>/dev/null), out: ${out:0:200}"; fi
    mode bad
    echo edited >"$R/edited.txt"
    out="$(cd "$R" && printf '%s\n' '{"session_id":"hook 1"}' | HOME="$T/home" USERPROFILE="$T/home" CLAUDE_PLUGIN_ROOT="$PLUGIN" CLAUDE_GATE_STATE="$T/state-hook" PATH="$NONODE" /bin/sh -c "$hook" 2>&1)"; rc=$?
    out="$(printf '%s' "$out" | tr -d '\r')"
    if [ "$rc" -eq 3 ] && [ "${out%%$'\n'*}" = "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: node не найден" ]; then ok "the hook command without node: the «ПРОВЕРИТЬ НЕ УДАЛОСЬ: node не найден» line and exit 3"
    else bad "the hook command without node ($hook): rc=$rc, out: ${out:0:300}"; fi
    if jq -e --arg wt "$R" '
        .version == 1 and .outcome == "unverified" and .profile == "fast" and .worktree == $wt and .key == null
        and (.head | test("^[0-9a-f]{40}$")) and .exit == 3
        and (.at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")) and .reason == "node not found"
        and (keys_unsorted == ["version", "outcome", "profile", "worktree", "key", "head", "exit", "at", "reason"])' "$verdict_file" >/dev/null 2>&1; then
        ok "the hook command without node: the verdict file says unverified, exit 3, \"node not found\", not green"
    else bad "the hook command without node: the verdict file: $(head -c 400 "$verdict_file" 2>/dev/null)"; fi
    marker="$T/state-hook/nokey-broken-$(tag "$R")-hook_1"
    if [ "$(tr -d '\r' <"$marker" 2>/dev/null)" = "node не найден. Repository: $R. The gate does not work without node — this is not green: the work was not verified by the gate." ]; then
        ok "the hook command without node: the marker of the worktree and the session, with the reason"
    else bad "the hook command without node: marker $marker: $(head -c 300 "$marker" 2>/dev/null); state: $(ls "$T/state-hook" | tr '\n' ' ')"; fi
    if [ -z "$(find "$T/state-hook" -maxdepth 1 -type f -name '.verdict-*')" ]; then ok "the hook command without node: no temporary file is left"
    else bad "left in the state folder: $(find "$T/state-hook" -maxdepth 1 -type f -name '.verdict-*')"; fi
    # The verdict file cannot be put in place (mv fails, as on a full disk): the green file of the
    # run before goes too, and so does the temporary file. `mv` is a bash function exported to the
    # launcher, so this works on every system.
    mkdir -p "$T/state-mv"
    verdict_mv="$T/state-mv/verdict-$(tag "$R").json"
    mode ok
    out="$(cd "$R" && CLAUDE_GATE_STATE="$T/state-mv" GATE_SCOPE=all node "$GATE" fast </dev/null 2>&1)"; rc=$?
    if [ "$(jqr .outcome "$verdict_mv" 2>/dev/null)" = green ]; then ok "before a verdict file that cannot be put in place: a green file"
    else bad "before a verdict file that cannot be put in place: rc=$rc, out: ${out:0:200}"; fi
    out="$(cd "$R" && mv() { return 1; } && export -f mv && HOME="$T/home" USERPROFILE="$T/home" CLAUDE_GATE_STATE="$T/state-mv" PATH="$NONODE" "$BASH" "$LAUNCHER" fast </dev/null 2>&1)"; rc=$?
    out="$(printf '%s' "$out" | tr -d '\r')"
    if [ "$rc" -eq 3 ] && [ "${out%%$'\n'*}" = "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: node не найден" ] && [ ! -e "$verdict_mv" ] \
        && [ -z "$(find "$T/state-mv" -maxdepth 1 -type f -name '.verdict-*')" ] && [ -s "$T/state-mv/nokey-broken-$(tag "$R")-anon" ]; then
        ok "without node, the verdict file cannot be put in place: exit 3, the line, the marker; the green file of the run before and the temporary file are gone"
    else bad "without node, the verdict file cannot be put in place: rc=$rc, files: $(ls -A "$T/state-mv" | tr '\n' ' '), out: ${out:0:300}"; fi

    # --- 6a. Which node the launcher picks --------------------------------------------------
    # ORDER is a copy of gate.sh whose two folders are folders of the test: $T/order/brew stands for
    # /opt/homebrew/bin, $T/order/local for /usr/local/bin. Each "node" of the test writes its name
    # to $T/order/used when it starts the gate and runs the real node; the version check the launcher
    # makes (node -e …) is answered by the real node, or refused by an "old" one.
    ORDER="$PLUGIN/hooks/gate-order.sh"
    sed -e "s#/opt/homebrew/bin#$T/order/brew#" -e "s#/usr/local/bin#$T/order/local#" "$SHIM" >"$ORDER"
    chmod +x "$ORDER"
    real_node="$(command -v node)"
    # fakenode <folder> <name> [old]
    fakenode() {
        mkdir -p "$1"
        if [ "${3:-}" = old ]; then
            printf '#!/bin/sh\n[ "$1" = -e ] && exit 1\necho %s >"%s/order/used"\nexec "%s" "$@"\n' "$2" "$T" "$real_node" >"$1/node"
        else
            printf '#!/bin/sh\n[ "$1" = -e ] || echo %s >"%s/order/used"\nexec "%s" "$@"\n' "$2" "$T" "$real_node" >"$1/node"
        fi
        chmod +x "$1/node"
    }
    NVM="$T/order/home/.nvm/versions/node"
    fakenode "$T/order/brew" brew
    fakenode "$T/order/local" local
    fakenode "$NVM/v9.0.0/bin" v9
    fakenode "$NVM/v24.1.0/bin" v24
    fakenode "$T/order/oldpath" oldpath old
    mkdir -p "$T/state-order"
    # picks <description> <expected name> [PATH]: runs ORDER and checks that the gate ran green
    # through the node of that name.
    picks() {
        rm -f "$T/order/used"
        out="$(cd "$R" && HOME="$T/order/home" USERPROFILE="$T/order/home" CLAUDE_GATE_STATE="$T/state-order" GATE_SCOPE=all PATH="${3:-$NONODE}" "$BASH" "$ORDER" fast </dev/null 2>&1)"; rc=$?
        local used; used="$(cat "$T/order/used" 2>/dev/null)"
        if [ "$rc" -eq 0 ] && [[ "$out" == *"[gate] зелено (fast): t/.:check"* ]] && [ "$used" = "$2" ]; then ok "$1: the gate runs on the node of $2"
        else bad "$1: used: ${used:-none} (expected $2), rc=$rc, out: ${out:0:300}"; fi
    }
    mode ok
    picks "node in both folders and under nvm, none on PATH" brew
    rm -f "$T/order/brew/node"
    picks "node in /usr/local/bin and under nvm" local
    rm -f "$T/order/local/node"
    picks "nvm has v9.0.0 and v24.1.0" v24
    # A folder on PATH in the spelling of the shell: C:/… on Windows would split at its colon.
    oldpath="$T/order/oldpath"; [ "$WIN" -eq 1 ] && oldpath="$(cygpath -u "$oldpath")"
    picks "an old node first on PATH (it refuses the version check)" v24 "$oldpath:$NONODE"
    fakenode "$NVM/v24.1.0/bin" v24 old
    picks "the newest node of nvm is too old" v9
    # The version boundary itself, with copies of ORDER whose NODE_MIN is the major version of the
    # real node, and one above it. Equal passes (v9 here runs the real node); above it nothing
    # passes, and the answer names the node that was found and refused, not «node не найден».
    major="$(node -p 'process.versions.node.split(".")[0]' | tr -d '\r')"
    for min in "$major" "$((major + 1))"; do
        sed "s#^NODE_MIN=18\$#NODE_MIN=$min#" "$ORDER" >"$PLUGIN/hooks/gate-min-$min.sh"
        chmod +x "$PLUGIN/hooks/gate-min-$min.sh"
    done
    if ! grep -q "^NODE_MIN=$major\$" "$PLUGIN/hooks/gate-min-$major.sh"; then bad "gate.sh has no line NODE_MIN=18 to change"; else
        ORDER_SAVED="$ORDER"
        ORDER="$PLUGIN/hooks/gate-min-$major.sh"
        picks "NODE_MIN equal to the major version of the real node ($major)" v9
        ORDER="$PLUGIN/hooks/gate-min-$((major + 1)).sh"
        mkdir -p "$T/state-min"
        rm -f "$T/order/used"
        out="$(cd "$R" && HOME="$T/order/home" USERPROFILE="$T/order/home" CLAUDE_GATE_STATE="$T/state-min" GATE_SCOPE=all PATH="$NONODE" "$BASH" "$ORDER" fast </dev/null 2>&1)"; rc=$?
        out="$(printf '%s' "$out" | tr -d '\r')"
        want="no node $((major + 1)) or newer: $NVM/v24.1.0/bin/node is older or did not start"
        if [ "$rc" -eq 3 ] && [ "${out%%$'\n'*}" = "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: $want" ] && [ ! -e "$T/order/used" ] \
            && [ "$(jqr .reason "$T/state-min/verdict-$(tag "$R").json" 2>/dev/null)" = "$want" ] \
            && grep -qF "$want. Repository: $R. The gate needs node $((major + 1)) or newer" "$T/state-min/nokey-broken-$(tag "$R")-anon" 2>/dev/null; then
            ok "NODE_MIN above the real node: exit 3, the line, the reason and the marker name the node refused, the gate did not run"
        else bad "NODE_MIN above the real node: rc=$rc, used: $(cat "$T/order/used" 2>/dev/null), reason: $(jqr .reason "$T/state-min/verdict-$(tag "$R").json" 2>/dev/null), out: ${out:0:300}"; fi
        ORDER="$ORDER_SAVED"
    fi
    # Outside git there is nothing to say, as for the gate itself.
    mkdir -p "$T/state-none"
    out="$(cd "$T/none" && HOME="$T/home" USERPROFILE="$T/home" CLAUDE_GATE_STATE="$T/state-none" PATH="$NONODE" "$BASH" "$LAUNCHER" fast </dev/null 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ] && [ -z "$out" ] && [ -z "$(ls "$T/state-none")" ]; then ok "without node, outside git: exit 0, no output, no file"
    else bad "without node, outside git: rc=$rc, out: ${out:0:200}, files: $(ls "$T/state-none" | tr '\n' ' ')"; fi

    # --- 7. The same state folder and the same tag as gate-paths.mjs -----------------------
    # The launcher without node and `node gate.mjs` (with a registry resolver that crashes, so
    # that it leaves the same kind of marker) run in the same worktree, each with a Harness home
    # of its own. Both must leave the two files of that worktree and session, under gate/state of
    # their home; the tag in the names is counted here by node from the path git prints.
    printf '#!/usr/bin/env node\nthrow new Error("boom")\n' >"$T/crash.mjs"
    names() { (cd "$1" 2>/dev/null && find . -maxdepth 1 -type f | sort | tr '\n' ' '); }
    # agree <description> <folder to run in> <a name for the folders of this case> <harness | home>:
    # the home of the Harness is named by HARNESS_HOME, or left to the home folder of the user.
    agree() {
        local d="$1" wt="$2" a="$T/agree-$3-sh" b="$T/agree-$3-js" top t want
        mkdir -p "$a" "$b"
        if [ "$4" = harness ]; then
            (cd "$wt" && printf '%s\n' '{"session_id":"same"}' | HOME="$T/home" USERPROFILE="$T/home" CLAUDE_GATE_STATE= HARNESS_HOME="$a" PATH="$NONODE" "$BASH" "$LAUNCHER" fast >/dev/null 2>&1)
            (cd "$wt" && printf '%s\n' '{"session_id":"same"}' | CLAUDE_GATE_STATE= HARNESS_HOME="$b" CLAUDE_GATE_RESOLVE="$T/crash.mjs" node "$GATE" fast >/dev/null 2>&1)
        else
            (cd "$wt" && printf '%s\n' '{"session_id":"same"}' | HOME="$a" USERPROFILE="$a" CLAUDE_GATE_STATE= HARNESS_HOME= PATH="$NONODE" "$BASH" "$LAUNCHER" fast >/dev/null 2>&1)
            (cd "$wt" && printf '%s\n' '{"session_id":"same"}' | HOME="$b" USERPROFILE="$b" CLAUDE_GATE_STATE= HARNESS_HOME= CLAUDE_GATE_RESOLVE="$T/crash.mjs" node "$GATE" fast >/dev/null 2>&1)
            a="$a/.claude/worfy-harness" b="$b/.claude/worfy-harness"
        fi
        top="$(cd "$wt" && git rev-parse --show-toplevel)"
        t="$(tag "$top")"
        want="./nokey-broken-$t-same ./verdict-$t.json "
        if [ "$(names "$a/gate/state")" = "$want" ] && [ "$(names "$b/gate/state")" = "$want" ] \
            && [ "$(jqr .worktree "$a/gate/state/verdict-$t.json")" = "$top" ] && [ "$(jqr .worktree "$b/gate/state/verdict-$t.json")" = "$top" ]; then
            ok "$d: gate.sh and gate.mjs leave the same files (tag $t) in gate/state of the Harness home"
        else
            bad "$d: expected $want; gate.sh left: $(names "$a/gate/state"); gate.mjs left: $(names "$b/gate/state"); worktree by gate.sh: $(jqr .worktree "$a/gate/state/verdict-$t.json" 2>/dev/null)"
        fi
    }
    SPACE="$T/with a space"
    CYR="$T/репозиторий с ё"
    newrepo "$SPACE"; newrepo "$CYR"
    agree "a path with a space" "$SPACE" space harness
    agree "a path with Cyrillic letters" "$CYR" cyr harness
    agree "a path with a space, the Harness home under the home folder of the user" "$SPACE" space-home home
    if [ "$WIN" -eq 1 ]; then echo "skip the check of a path reached through a symlink: Git Bash on Windows copies instead of linking"; else
        ln -s "$SPACE" "$T/link"
        agree "a path reached through a symlink" "$T/link" link harness
    fi
fi

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
