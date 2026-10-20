#!/usr/bin/env bash
# Tests of the gate's file size warning: a file that the diff from the merge-base takes from at
# most 1000 lines to more than 1000 gets the line
#   [gate] warning: file over 1000 lines: <path> (<before> → <after>)
# before the verdict line. It is a warning: the exit code, the verdict line and the verdict file
# are the same as without it.
#   - 900 → 1100 warns; 1200 → 1300 does not (the file was long already); a new file of 1500 warns;
#   - the limit itself: 1000 → 1001 warns, 900 → 1000 does not; a last line without a newline counts;
#   - committed on the branch, staged, edited in the worktree, untracked, in an untracked folder;
#   - not counted: lock files, *.min.js, *.map, *.snap, dist/ out/ build/, binary files (by content
#     and by .gitattributes), deleted files, symlinks; a long file that was only renamed;
#   - a green cache hit prints the warning again; red stays red; a narrowed scope warns too;
#   - without a merge-base the check is skipped silently.
# Run: bash harness/hooks/tests/gate-file-size.test.sh; exit code 0 means everything passed.
# HOOKS_DIR runs the test on another copy of the hooks (for example, on the version before an edit).
#
# The registry, the state folder and the repositories are temporary (CLAUDE_GATE_CONFIG,
# CLAUDE_GATE_STATE): the test does not touch the live registry or markers.
set -u
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads; a path like
# /c/… or /tmp/… means nothing to node. Elsewhere there is no -W.
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
# node, not shasum: Git Bash has shasum only where perl is on PATH.
tag() { node -e 'process.stdout.write(require("node:crypto").createHash("sha1").update(process.argv[1]).digest("hex").slice(0, 8))' "$1"; }
STATE="$T/state"
export CLAUDE_GATE_STATE="$STATE" CLAUDE_GATE_CONFIG="$T/config.json"
mkdir -p "$STATE"

# --- fixtures ---------------------------------------------------------------------
# The gate runs "$PM run <script>"; pm is this file, so the test needs no npm. What the script
# does is set by $T/mode: ok or bad (a real test failure). On Windows the file is a .cmd: node
# starts nothing else there without an interpreter.
if [ "$WIN" -eq 1 ]; then
    PM="$T/fakepm.cmd"
    cat >"$PM" <<'EOF'
@echo off
set /p m=<"%~dp0mode"
if "%m%"=="ok" exit /b 0
if "%m%"=="bad" (echo Tests 1 failed& exit /b 1)
exit /b 1
EOF
else
    PM="$T/fakepm"
    cat >"$PM" <<EOF
#!/bin/sh
case "\$(cat "$T/mode")" in
    ok) exit 0 ;;
    bad) echo "Tests 1 failed"; exit 1 ;;
esac
exit 1
EOF
    chmod +x "$PM"
fi
mode() { echo "$1" >"$T/mode"; }
mode ok

lines() { # $1 = how many lines, $2 = file
    mkdir -p "$(dirname "$2")"
    seq 1 "$1" >"$2"
}
commit() { git -C "$1" add -A && git -C "$1" -c user.email=t@t -c user.name=t commit -q -m "$2"; }
newrepo() { # $1 = path: a repository with one commit; the caller adds files and calls `based`
    mkdir -p "$1"
    git -C "$1" init -q -b main
    echo '{ "name": "fixture", "scripts": { "check": "true" } }' >"$1/package.json"
    commit "$1" init
}
based() { git -C "$1" update-ref refs/remotes/origin/main HEAD; }   # origin/main = the commit so far
gate() { # $1 = repository, $2 = profile, the rest = environment; sets out (stdout and stderr) and rc
    local repo="$1" profile="$2"; shift 2
    out="$(cd "$repo" && env "$@" node "$GATE" "$profile" </dev/null 2>&1)"; rc=$?
}
WARN='[gate] warning: file over 1000 lines: '
warns() { # $1 = description, $2 = path, $3 = before, $4 = after
    if printf '%s\n' "$out" | grep -qxF "$WARN$2 ($3 → $4)"; then ok "$1"; else
        bad "$1 (no line «$WARN$2 ($3 → $4)»; rc=$rc, out: ${out:0:600})"
    fi
}
silent() { # $1 = description, $2 = path: no warning names it
    if printf '%s\n' "$out" | grep -qF "$WARN$2 ("; then
        bad "$1 (a warning for $2; out: ${out:0:600})"
    else ok "$1"; fi
}
nwarn() { printf '%s\n' "$out" | grep -cF "$WARN"; }
verdict_json() { jq -S 'del(.at)' "$STATE/verdict-$(tag "$1").json" 2>/dev/null; }

R="$T/reg"      # key "t": the main fixture
C="$T/control"  # key "c": the same project with no file over the limit
N="$T/nobase"   # key "n": no origin/main, so no merge-base
S="$T/narrow"   # key "s": root scripts only for *.ts, the scope is narrowed by the diff
for r in "$R" "$C" "$N" "$S"; do newrepo "$r"; done
jq -n --arg r "$R" --arg c "$C" --arg n "$N" --arg s "$S" --arg pm "$PM" '{repos: [
    {key: "t", match: $r, pm: $pm, root: {fast: ["check"], full: ["check"]}, workspace: {}},
    {key: "c", match: $c, pm: $pm, root: {fast: ["check"], full: ["check"]}, workspace: {}},
    {key: "n", match: $n, pm: $pm, root: {fast: ["check"]}, workspace: {}},
    {key: "s", match: $s, pm: $pm, root: {fast: ["check"]}, root_if: "\\.ts$", workspace: {}}
]}' >"$CLAUDE_GATE_CONFIG"

# --- 1. The base commit of R, then the changes of the branch ---------------------------
lines 900 "$R/grow.ts"              # 900 → 1100: warns
lines 1200 "$R/long.ts"             # 1200 → 1300: was long already
lines 900 "$R/pnpm-lock.yaml"       # lock files are not counted
lines 900 "$R/package-lock.json"
lines 900 "$R/yarn.lock"
lines 900 "$R/sub/Cargo.lock"
lines 900 "$R/sub/npm-shrinkwrap.json"
lines 900 "$R/go.sum"
lines 900 "$R/vendor.min.js"        # generated files are not counted
lines 900 "$R/bundle.js.map"
lines 900 "$R/__snapshots__/a.test.ts.snap"
lines 900 "$R/dist/a.js"
lines 900 "$R/pkg/out/a.js"
lines 900 "$R/pkg/build/a.js"
lines 900 "$R/out/b.js"
lines 900 "$R/build/b.js"
lines 1000 "$R/edge-up.ts"         # 1000 → 1001: crosses the limit
lines 900 "$R/edge-at.ts"           # 900 → 1000: at the limit, not over it
lines 900 "$R/gone.ts"              # deleted on the branch
lines 900 "$R/committed.ts"         # grows in a commit of the branch, the worktree is clean
lines 900 "$R/staged.ts"            # grows in the index
lines 1200 "$R/moved-from.ts"       # renamed without edits: was long under the old name
lines 900 "$R/short-from.ts"        # renamed and grown to 1100: crossed the limit under the new name
lines 900 "$R/with space.ts"        # a path with a space
lines 900 "$R/distant/a.ts"         # "dist" only as the start of a folder name: counted
lines 900 "$R/заметки/файл.md"      # a path that is not ASCII
lines 900 "$R/table.dat"            # binary by .gitattributes, text by content
printf '*.dat binary\n' >"$R/.gitattributes"
commit "$R" base
based "$R"

lines 1100 "$R/committed.ts"
commit "$R" "branch commit"
HEAD_R="$(git -C "$R" rev-parse HEAD)"
lines 1100 "$R/staged.ts"
git -C "$R" add staged.ts
git -C "$R" mv moved-from.ts moved-to.ts
git -C "$R" mv short-from.ts short-to.ts
lines 1100 "$R/short-to.ts"
git -C "$R" rm -q gone.ts
lines 1100 "$R/grow.ts"
lines 1300 "$R/long.ts"
for f in pnpm-lock.yaml package-lock.json yarn.lock sub/Cargo.lock sub/npm-shrinkwrap.json go.sum vendor.min.js bundle.js.map \
    __snapshots__/a.test.ts.snap dist/a.js pkg/out/a.js pkg/build/a.js out/b.js build/b.js "with space.ts" distant/a.ts "заметки/файл.md" table.dat; do
    lines 1100 "$R/$f"
done
lines 1001 "$R/edge-up.ts"
lines 1000 "$R/edge-at.ts"
lines 1500 "$R/new.ts"                       # a new untracked file
lines 1500 "$R/newdir/deep/inside.ts"        # a new file in an untracked folder
lines 1500 "$R/newdir/dist/gen.js"           # … and a generated one next to it
lines 1000 "$R/no-newline.ts"                # 1001 lines, the last one without a newline
printf 'last' >>"$R/no-newline.ts"
{ seq 1 1500; printf 'a\0b\n'; } >"$R/blob.bin"   # binary: a NUL byte, 1501 newlines
ln -s grow.ts "$R/link.ts"                   # a symlink to a long file is not a long file
# Git Bash without the right to create symlinks copies the file instead: then there is no
# symlink to check, and the copy must not stay as one more long file.
if [ -L "$R/link.ts" ]; then HAVE_LINK=1; else HAVE_LINK=0; rm -f "$R/link.ts"; fi

gate "$R" fast GATE_SCOPE=all
rc_warn=$rc
warns "900 → 1100 lines: a warning" "grow.ts" 900 1100
silent "1200 → 1300 lines: no warning, the file was long already" "long.ts"
warns "a new file of 1500 lines: a warning" "new.ts" 0 1500
silent "pnpm-lock.yaml 900 → 1100: no warning" "pnpm-lock.yaml"
silent "package-lock.json: no warning" "package-lock.json"
silent "yarn.lock: no warning" "yarn.lock"
silent "sub/Cargo.lock (any *.lock): no warning" "sub/Cargo.lock"
silent "npm-shrinkwrap.json below the root: no warning" "sub/npm-shrinkwrap.json"
silent "go.sum: no warning" "go.sum"
silent "*.min.js: no warning" "vendor.min.js"
silent "*.map: no warning" "bundle.js.map"
silent "*.snap: no warning" "__snapshots__/a.test.ts.snap"
silent "dist/: no warning" "dist/a.js"
silent "out/ below the root: no warning" "pkg/out/a.js"
silent "build/ below the root: no warning" "pkg/build/a.js"
silent "out/ at the root: no warning" "out/b.js"
silent "build/ at the root: no warning" "build/b.js"
warns "distant/ is not dist/: a warning" "distant/a.ts" 900 1100
warns "1000 → 1001 lines: a warning" "edge-up.ts" 1000 1001
silent "900 → 1000 lines: no warning, 1000 is within the limit" "edge-at.ts"
silent "a deleted file: no warning" "gone.ts"
warns "grown in a commit of the branch: a warning" "committed.ts" 900 1100
warns "grown in the index: a warning" "staged.ts" 900 1100
silent "a long file renamed without edits: no warning" "moved-to.ts"
warns "a file renamed and grown past the limit: a warning with its old length" "short-to.ts" 900 1100
warns "a path with a space: a warning" "with space.ts" 900 1100
warns "a new file in an untracked folder: a warning" "newdir/deep/inside.ts" 0 1500
silent "dist/ inside an untracked folder: no warning" "newdir/dist/gen.js"
warns "1001 lines, the last without a newline: a warning" "no-newline.ts" 0 1001
silent "a binary file: no warning" "blob.bin"
silent "a file that .gitattributes calls binary: no warning" "table.dat"
warns "a path that is not ASCII: a warning" "заметки/файл.md" 900 1100
if [ "$HAVE_LINK" -eq 1 ]; then silent "a symlink to a long file: no warning" "link.ts"
else echo "skip a symlink to a long file: this system made a copy, not a symlink"; fi
if [ "$(nwarn)" -eq 11 ]; then ok "eleven warnings, one per file"; else bad "eleven warnings expected, got $(nwarn) (out: ${out:0:900})"; fi

# The warning changes neither the verdict line nor the exit code; the verdict line is the last line.
if [ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | tail -n 1)" = "[gate] green (fast): t/.:check" ]; then
    ok "with warnings: exit 0 and the verdict line «[gate] green (fast): t/.:check» is the last line"
else
    bad "with warnings: exit 0 and the green verdict as the last line expected (rc=$rc, out: ${out:0:600})"
fi
first_warn="$(printf '%s\n' "$out" | grep -nF "$WARN" | head -n 1 | cut -d: -f1)"
last_warn="$(printf '%s\n' "$out" | grep -nF "$WARN" | tail -n 1 | cut -d: -f1)"
scope_at="$(printf '%s\n' "$out" | grep -n '^\[gate\] scope (fast)' | cut -d: -f1)"
verdict_at="$(printf '%s\n' "$out" | grep -n '^\[gate\] green' | cut -d: -f1)"
if [ -n "$first_warn" ] && [ -n "$scope_at" ] && [ -n "$verdict_at" ] &&
    [ "$scope_at" -lt "$first_warn" ] && [ "$last_warn" -lt "$verdict_at" ]; then
    ok "the warnings come after the scope line and before the verdict line"
else
    bad "order: scope, warnings, verdict expected (scope=$scope_at, warnings=$first_warn..$last_warn, verdict=$verdict_at)"
fi
want="$(jq -n -S --arg wt "$R" --arg head "$HEAD_R" \
    '{version: 1, outcome: "green", profile: "fast", worktree: $wt, key: "t", head: $head, exit: 0, reason: null}')"
if [ "$(verdict_json "$R")" = "$want" ]; then ok "with warnings: the verdict file is the green one, no new keys"; else
    bad "verdict file with warnings: $(verdict_json "$R")"
fi

# --- 2. A cache hit prints the warnings again ------------------------------------------
gate "$R" fast GATE_SCOPE=all
if [ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | tail -n 1)" = "[gate] green (fast): t/.:check (cache)" ]; then
    ok "second run: a cache hit, exit 0"
else
    bad "a cache hit expected (rc=$rc, out: ${out:0:600})"
fi
warns "cache hit: the warning is printed again" "grow.ts" 900 1100
if [ "$(nwarn)" -eq 11 ]; then ok "cache hit: all eleven warnings again"; else bad "cache hit: eleven warnings expected, got $(nwarn)"; fi
# Like the scope line, the warning goes to stdout: with stderr dropped it is still there.
out="$(cd "$R" && GATE_SCOPE=all node "$GATE" fast </dev/null 2>/dev/null)"; rc=$?
warns "the warning is on stdout" "grow.ts" 900 1100

# --- 3. The same run without a long file: the same exit code, verdict line and file ------
lines 900 "$C/grow.ts"
commit "$C" base
based "$C"
lines 950 "$C/grow.ts"
gate "$C" fast GATE_SCOPE=all
if [ "$(nwarn)" -eq 0 ]; then ok "control (900 → 950): no warning"; else bad "control: a warning (out: ${out:0:400})"; fi
if [ "$rc" -eq "$rc_warn" ] && [ "$(printf '%s\n' "$out" | tail -n 1)" = "[gate] green (fast): c/.:check" ]; then
    ok "control: the exit code is the same as with warnings ($rc_warn)"
else
    bad "control: rc=$rc, with warnings rc=$rc_warn (out: ${out:0:400})"
fi
# Without the warning lines and the log line, which names a folder of its own run.
# The timing line and the log path differ from run to run by themselves.
strip() { printf '%s\n' "$1" | grep -vF "$WARN" | grep -v '^--- full output ' | grep -v '^\[gate\] time '; }
lines 1100 "$C/grow.ts"
gate "$C" fast GATE_SCOPE=all
out_c_warn="$out" rc_c_warn=$rc json_c_warn="$(verdict_json "$C")"
warns "control repository after 950 → 1100: a warning" "grow.ts" 900 1100
lines 950 "$C/grow.ts"   # a fresh run again: the cache keeps only the fingerprint of the last green content
gate "$C" fast GATE_SCOPE=all
if [ "$rc" -eq "$rc_c_warn" ] && [ "$(strip "$out_c_warn")" = "$(strip "$out")" ] && [ "$json_c_warn" = "$(verdict_json "$C")" ]; then
    ok "green: without the warning lines the output, the exit code and the verdict file are the same"
else
    bad "green: the warning changed more than its own lines (rc $rc_c_warn vs $rc; with: ${out_c_warn:0:300}; without: ${out:0:300})"
fi

# --- 4. Red stays red: exit 2, the red verdict, and the warning is still printed ---------
mode bad
lines 1100 "$C/grow.ts"
gate "$C" full GATE_SCOPE=all
out_c_warn="$out" rc_c_warn=$rc json_c_warn="$(verdict_json "$C")"
warns "red run: the warning is printed" "grow.ts" 900 1100
if [ "$rc" -eq 2 ] && printf '%s\n' "$out" | grep -qxF "[gate] red (full): c/.:check"; then
    ok "red run with a warning: exit 2 and «[gate] red (full): c/.:check»"
else
    bad "red run with a warning: exit 2 and the red line expected (rc=$rc, out: ${out:0:400})"
fi
if [ "$(printf '%s\n' "$out" | grep -nF "$WARN" | cut -d: -f1)" -lt "$(printf '%s\n' "$out" | grep -n '^\[gate\] red' | cut -d: -f1)" ]; then
    ok "red run: the warning comes before the verdict line"
else
    bad "red run: the warning must come before the verdict line (out: ${out:0:400})"
fi
lines 950 "$C/grow.ts"
gate "$C" full GATE_SCOPE=all
if [ "$rc" -eq "$rc_c_warn" ] && [ "$(strip "$out_c_warn")" = "$(strip "$out")" ] && [ "$json_c_warn" = "$(verdict_json "$C")" ]; then
    ok "red: without the warning line the output, the exit code and the verdict file are the same"
else
    bad "red: the warning changed more than its own line (rc $rc_c_warn vs $rc; with: ${out_c_warn:0:300}; without: ${out:0:300})"
fi
mode ok

# --- 5. No merge-base: the check is skipped silently -------------------------------------
lines 1500 "$N/new.ts"
gate "$N" fast
if [ "$rc" -eq 0 ] && [ "$(nwarn)" -eq 0 ] && [[ "$out" == *"no base for a diff"* ]] &&
    [ "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" -eq 3 ] && [[ "$out" == *$'\n'"[gate] time (fast): "*$'\n'"[gate] green (fast): n/.:check" ]]; then
    ok "no merge-base: no warning, only the scope line, the timing line and the verdict line"
else
    bad "no merge-base: a silent skip expected (rc=$rc, out: ${out:0:600})"
fi

# --- 6. A scope narrowed by the diff warns too, also when nothing ran ---------------------
lines 900 "$S/a.ts"
lines 900 "$S/notes.md"
commit "$S" base
based "$S"
git -C "$S" checkout -q -b work
lines 1100 "$S/notes.md"
gate "$S" fast
warns "narrowed scope, the change touches no checked package: a warning" "notes.md" 900 1100
if [ "$rc" -eq 0 ] && [[ "$(printf '%s\n' "$out" | tail -n 1)" == "[gate] nothing ran (fast): the changes touch no checked package."* ]] &&
    [ "$(jq -r .outcome "$STATE/verdict-$(tag "$S").json" 2>/dev/null | tr -d '\r')" = "none" ]; then
    ok "narrowed scope: «nothing ran» is still the last line, outcome none, exit 0"
else
    bad "narrowed scope: «nothing ran» expected (rc=$rc, out: ${out:0:600})"
fi
lines 1100 "$S/a.ts"
gate "$S" fast
warns "narrowed scope, a checked file grew: a warning" "a.ts" 900 1100
if [ "$rc" -eq 0 ] && [[ "$out" == *"narrowed by the diff"* ]] && [ "$(printf '%s\n' "$out" | tail -n 1)" = "[gate] green (fast): s/.:check" ]; then
    ok "narrowed scope: green, exit 0"
else
    bad "narrowed scope: green expected (rc=$rc, out: ${out:0:600})"
fi

# --- 7. The check leaves nothing behind ---------------------------------------------------
if [ -z "$(git -C "$S" status --porcelain --ignored | grep -v -e ' a.ts$' -e ' notes.md$')" ] &&
    [ -z "$(find "$STATE" -maxdepth 1 -name '.*' ! -name '.' -print)" ]; then
    ok "no files left in the worktree or in the state folder"
else
    bad "leftovers: $(git -C "$S" status --porcelain --ignored | tr '\n' ' ') $(find "$STATE" -maxdepth 1 -name '.*' -print | tr '\n' ' ')"
fi

echo
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
