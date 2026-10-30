#!/usr/bin/env bash
# Tests of bin/code-map: the code map of a repository that the scout reads first. One Markdown file
# per repository, in the state folder of the project's profile (outside the repository); every folder
# section names the commit it was described at, and `code-map stale` lists the folders whose files
# `git diff --name-only <commit> HEAD` reports as changed.
#   - no map: `stale` exits 0 and prints "no map: <path>"; `path` prints the same path, under
#     <profile dir>/state/code-map/<repository>.md, the same from a worktree of the repository;
#   - `put <folder>` writes the description from stdin with the commit of HEAD; a second put of the
#     same folder replaces its section, the other sections stay;
#   - a commit that changes a file in a folder makes that folder stale, a commit in another folder
#     does not; a folder whose name starts another folder's name (src/a, src/ab) is not confused with
#     it; a file moved out of a folder makes it stale; a commit the repository does not have makes the
#     folder stale and says so on stderr; a map with CRLF line ends reads the same;
#   - refusals: no description, a folder that is not there or leaves the repository, a description
#     with a level-1 or level-2 heading — exit 2 and the map unchanged; a repository of no registered
#     project — exit 3; no subcommand — exit 2.
# Run: bash harness/bin/tests/code-map.test.sh; exit code 0 means everything passed.
# BIN_DIR points it at another copy of bin/ (that copy needs ../hooks and ../lib next to it).
# Everything lives in a temporary directory: HOME and HARNESS_HOME included; at the end the test
# compares the real ~/.claude (the Harness parts) with a snapshot taken before the run.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
CM="$BIN/code-map"
REAL_HOME="$HOME"
. "$(dirname "$0")/real-home.sh"
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads; the registry
# below must name the repository the way node reads it.
T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
before="$(real_home_snapshot "$REAL_HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export HOME="$T/home" USERPROFILE="$T/home"
export HARNESS_HOME="$T/hh"
unset EVAL_GIT EVAL_HARNESS_HOME CLAUDE_GATE_CONFIG CLAUDE_PROFILES_DIR CLAUDE_GATE_RESOLVE
mkdir -p "$HOME"
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid

# run <args...> — stdin from /dev/null; stdout -> $T/out, stderr -> $T/err, sets rc
run() { node "$CM" "$@" </dev/null >"$T/out" 2>"$T/err"; rc=$?; }
# put_desc <folder> <text> — `code-map put <folder>` in the repository with <text> on stdin
put_desc() { printf '%s\n' "$2" | node "$CM" put "$1" -C "$R" >"$T/out" 2>"$T/err"; rc=$?; }
# slashes <text> — the path with forward slashes (node prints C:\… on Windows)
slashes() { printf '%s' "$1" | tr '\\' '/'; }
# change <file> <text> — writes the file in the repository and commits it
change() { mkdir -p "$(dirname "$R/$1")"; printf '%s\n' "$2" >"$R/$1"; git -C "$R" add -A && git -C "$R" commit -qm "change $1"; }
# stale_is <name> <want> — `code-map stale` exits 0 and prints exactly <want>
stale_is() {
    run stale -C "$R"
    local got; got="$(tr -d '\r' <"$T/out")"
    [ "$rc" -eq 0 ] && [ "$got" = "$2" ] && ok "$1" \
        || bad "$1 (exit $rc)"$'\n'"--- got:"$'\n'"$got"$'\n'"--- want:"$'\n'"$2"$'\n'"--- stderr:"$'\n'"$(cat "$T/err")"
}

# --- 0. The script is there and executable ---------------------------------------------------------
[ -f "$CM" ] && [ -x "$CM" ] && ok "bin/code-map exists and is executable" || bad "bin/code-map is missing or not executable"
# Windows keeps no executable bit on disk: there the mode recorded in git is the only one.
mode="$(git -C "$HARNESS" ls-files -s -- bin/code-map 2>/dev/null | cut -c1-6)"
if [ "$BIN" != "$HARNESS/bin" ] || [ -z "$mode" ]; then echo "skip the mode in git: not the tracked copy"
elif [ "$mode" = 100755 ]; then ok "git records bin/code-map as executable (100755)"
else bad "git records bin/code-map as $mode, not 100755"; fi

# --- 1. A registered sample repository -------------------------------------------------------------
R="$T/repo"
mkdir -p "$R"
git -C "$R" init -q
git -C "$R" config core.autocrlf false
change src/a/one.txt 'one'
change src/ab/two.txt 'two'
change src/b/three.txt 'three'
change docs/readme.txt 'docs'
mkdir -p "$HARNESS_HOME/gate" "$HARNESS_HOME/projects/demo"
printf '{"repos":[{"key":"demo","match":"%s","profile":"demo","root":{},"workspace":{}}]}\n' "$R" >"$HARNESS_HOME/gate/config.json"
printf '%s\n' '{ "schema": 2, "name": "demo", "mode": "full" }' >"$HARNESS_HOME/projects/demo/profile.json"
MAP="$HARNESS_HOME/projects/demo/state/code-map/repo.md"

# --- 2. No map -------------------------------------------------------------------------------------
run path -C "$R"
[ "$rc" -eq 0 ] && [ "$(slashes "$(tr -d '\r' <"$T/out")")" = "$MAP" ] && ok "path: <profile dir>/state/code-map/<repository>.md" \
    || bad "path: exit $rc, got [$(cat "$T/out")], want [$MAP]; stderr: $(cat "$T/err")"
stale_is "no map: exit 0 and the line «no map: <path>»" "no map: $MAP"
[ ! -e "$MAP" ] && ok "stale with no map writes nothing" || bad "stale with no map created $MAP"

# --- 3. put ----------------------------------------------------------------------------------------
put_desc src/a 'Folder a: the first sample.'
[ "$rc" -eq 0 ] && [ -f "$MAP" ] && ok "put src/a: exit 0, the map is written" || bad "put src/a: exit $rc; stderr: $(cat "$T/err")"
put_desc src/ab 'Folder ab: its name starts with src/a.'
put_desc src/b 'Folder b: the second sample.'
head1="$(git -C "$R" rev-parse HEAD)"
sec() { awk -v h="## $1" '$0 == h {s = 1; print; next} s && /^## / {exit} s' "$MAP" | tr -d '\r'; }
[ "$(sec src/a | sed -n 2p)" = "commit: $head1" ] && ok "put: the section starts with the commit of HEAD" \
    || bad "put: section src/a is"$'\n'"$(sec src/a)"
sec src/a | grep -qxF 'Folder a: the first sample.' && ok "put: the description is in the section" || bad "put: no description in section src/a"
stale_is "right after put nothing is stale" ""

# --- 4. A change in one folder ---------------------------------------------------------------------
change src/a/one.txt 'one, changed'
stale_is "a commit in src/a makes src/a stale, not src/ab or src/b" "src/a"
change docs/readme.txt 'docs, changed'
stale_is "a commit in docs/ adds nothing" "src/a"
change src/ab/two.txt 'two, changed'
stale_is "a commit in src/ab makes src/ab stale too, in map order" "src/a
src/ab"

# --- 5. put again replaces the section --------------------------------------------------------------
put_desc src/a 'Folder a: described again.'
[ "$rc" -eq 0 ] && ok "second put src/a: exit 0" || bad "second put src/a: exit $rc; stderr: $(cat "$T/err")"
[ "$(grep -cx '## src/a' "$MAP")" = 1 ] && ok "second put: one section src/a, not two" || bad "second put: $(grep -cx '## src/a' "$MAP") sections src/a"
sec src/a | grep -qxF 'Folder a: described again.' && ! sec src/a | grep -qF 'the first sample' \
    && ok "second put: the new description replaced the old one" || bad "second put: section src/a is"$'\n'"$(sec src/a)"
sec src/b | grep -qxF 'Folder b: the second sample.' && ok "second put: section src/b stays" || bad "second put: section src/b lost"
stale_is "after put src/a only src/ab is stale" "src/ab"
put_desc src/ab 'Folder ab: described again.'
change src/ab/two.txt 'two, changed twice'
stale_is "a commit in src/ab does not make src/a stale (a name prefix is not a folder)" "src/ab"
put_desc src/ab 'Folder ab: described a third time.'

# --- 6. A file moved out of a folder ------------------------------------------------------------------
git -C "$R" mv src/b/three.txt docs/three.txt && git -C "$R" commit -qm "move three"
stale_is "a file moved out of src/b makes src/b stale" "src/b"
put_desc src/b 'Folder b: now empty in git.'

# --- 7. A commit the repository does not have --------------------------------------------------------
cp "$MAP" "$T/map-good"
node -e 'const fs = require("fs"); const f = process.argv[1]; const t = fs.readFileSync(f, "utf8").split("\n"); const i = t.indexOf("## src/b"); t[i + 1] = "commit: " + "0".repeat(40); fs.writeFileSync(f, t.join("\n"))' "$MAP"
stale_is "an unknown commit makes its folder stale" "src/b"
grep -q "0000000000000000000000000000000000000000" "$T/err" && ok "an unknown commit is named on stderr" || bad "stderr does not name the unknown commit: $(cat "$T/err")"
cp "$T/map-good" "$MAP"

# --- 8. CRLF line ends ----------------------------------------------------------------------------------
node -e 'const fs = require("fs"); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/\r?\n/g, "\r\n"))' "$MAP"
stale_is "a CRLF map: nothing stale" ""
change src/a/one.txt 'one, changed twice'
stale_is "a CRLF map: a commit in src/a makes src/a stale" "src/a"
put_desc src/a 'Folder a: after CRLF.'
[ "$rc" -eq 0 ] && [ "$(grep -c '^## ' "$MAP")" = 3 ] && ok "put into a CRLF map keeps three sections" || bad "put into a CRLF map: exit $rc, $(grep -c '^## ' "$MAP") sections"

# --- 9. The same map from a worktree of the repository ----------------------------------------------
git -C "$R" worktree add -q "$T/wt" -b side 2>/dev/null
run path -C "$T/wt"
[ "$rc" -eq 0 ] && [ "$(slashes "$(tr -d '\r' <"$T/out")")" = "$MAP" ] && ok "a worktree of the repository gets the same map" \
    || bad "worktree: exit $rc, got [$(cat "$T/out")]; stderr: $(cat "$T/err")"

# --- 10. Refusals -----------------------------------------------------------------------------------
cp "$MAP" "$T/map-before"
unchanged() { cmp -s "$MAP" "$T/map-before" && ok "$1: the map is unchanged" || bad "$1: the map changed"; }
run put src/a -C "$R"
[ "$rc" -eq 2 ] && ok "put with an empty stdin: exit 2" || bad "put with an empty stdin: exit $rc"
unchanged "empty description"
put_desc src/none 'No such folder.'
[ "$rc" -eq 2 ] && ok "put of a folder that is not there: exit 2" || bad "put of a missing folder: exit $rc"
put_desc ../outside 'Outside.'
[ "$rc" -eq 2 ] && ok "put of a folder outside the repository: exit 2" || bad "put of ../outside: exit $rc"
put_desc src/a $'Text.\n## Another section'
[ "$rc" -eq 2 ] && ok "put of a description with a level-2 heading: exit 2" || bad "put with a ## heading: exit $rc"
unchanged "refused puts"
run
[ "$rc" -eq 2 ] && ok "no subcommand: exit 2" || bad "no subcommand: exit $rc"
O="$T/other"; mkdir -p "$O"; git -C "$O" init -q
run stale -C "$O"
[ "$rc" -eq 3 ] && ok "a repository of no registered project: exit 3" || bad "unregistered repository: exit $rc; stderr: $(cat "$T/err")"

# --- the real home ------------------------------------------------------------------------------
after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$before" = "$after" ] && ok "the real home is not written" || { bad "the real home changed"; real_home_diff "$before" "$after"; }

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
