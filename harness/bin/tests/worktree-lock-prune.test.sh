#!/usr/bin/env bash
# worktree-lock removes the registry files of working trees that are gone ($HARNESS_HOME/worktree-sessions):
#   1. `worktree-lock prune` removes a file when every entry names a folder that does not exist (root; cwd for
#      an entry written before root was recorded) or when the file has no entries, and prints
#      "removed N of M registry files".
#   2. It keeps a file with at least one existing folder (also when its entries are older than the TTL), a
#      file that is not a JSON object, a file with an entry whose folder cannot be decided, and a file whose
#      mutex is busy, without waiting for it.
#   3. The removal re-reads the file and checks the folders again under the mutex: a tree re-created between
#      the first check and the mutex keeps its file.
#   4. claim prunes at most once a day (the mtime of worktree-sessions/.pruned), and an unreadable registry
#      folder leaves claim at exit 0 with an empty stdout.
#   5. An entry written by claim carries root, the top folder of the tree.
# Run: bash harness/bin/tests/worktree-lock-prune.test.sh; exit code 0 means everything passed.
# HOME and HARNESS_HOME are temporary folders: the real ~/.claude and its registry are neither read nor written.
set -u
HARNESS="${HARNESS_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"   # HARNESS_DIR — run against another copy
BIN="$HARNESS/bin"
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads. Elsewhere there is no -W,
# and pwd -P resolves /var to /private/var on macOS, as git rev-parse --show-toplevel does.
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'chmod -R u+rwx "$T" 2>/dev/null; rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
check() { # $1 = description, the rest = condition
    local d="$1"; shift
    if "$@"; then ok "$d"; else bad "$d"; fi
}
holds() { eval "$1"; }   # a condition of several tests, as shell text: '[ a ] && [ b ]'
mkdir -p "$T/home"

# worktree-lock with the HARNESS_HOME $1 and none of the variables the calling session may have set.
wl() {
    local hh="$1"; shift
    env -u EVAL_HARNESS_HOME -u EVAL_GIT -u CLAUDE_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u WORKTREE_LOCK_TTL_MIN \
        HOME="$T/home" USERPROFILE="$T/home" HARNESS_HOME="$hh" node "$BIN/worktree-lock" "$@"
}
claim() { # $1 = HARNESS_HOME, $2 = tree, $3 = session id; prints the hook's stdout
    (cd "$2" && printf '{"session_id":"%s","cwd":"%s"}' "$3" "$2" | wl "$1" claim)
}
prune() { (cd "$T" && wl "$1" prune </dev/null); }   # from a folder outside any repository
tree() { mkdir -p "$1" && git -C "$1" init -q; }
entry() { # $1 = key, $2 = folder; $3 = "root" or "cwd" — the field that names the folder (cwd: the old format)
    printf '"%s":{"started":1000,"seen":1000,"%s":"%s","branch":"main"}' "$1" "$3" "$2"
}
json_files() { find "$1" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' '; }
roots() { node -e 'const o = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(Object.values(o).map((e) => e.root).join(","))' "$1"; }

# --- 1. A deleted tree: prune removes its file; the entry claim wrote carries root ------------------------
H="$T/c1"; REG="$H/worktree-sessions"; A="$T/c1-trees/a"
tree "$A"
claim "$H" "$A" s1 >/dev/null 2>&1
f="$(ls "$REG"/*.json 2>/dev/null)"
check "claim: one registry file for the tree" [ "$(json_files "$REG")" = 1 ]
check "claim: the entry carries root, the tree's top folder" holds '[ -n "$f" ] && [ "$(roots "$f")" = "$(git -C "$A" rev-parse --show-toplevel)" ]'
rm -rf "$T/c1-trees/a"
out="$(prune "$H" 2>&1)"; rc=$?
check "prune: a deleted tree's file is removed, 'removed 1 of 1 registry files' (exit 0)" holds '[ "$rc" -eq 0 ] && [ "$out" = "removed 1 of 1 registry files" ] && [ ! -e "$f" ]'

# --- 2. What stays, what goes: one registry, many files ---------------------------------------------------
H="$T/c2"; REG="$H/worktree-sessions"; L="$T/c2-trees/live"; G="$T/c2-trees/gone"
tree "$L"; mkdir -p "$REG"
printf '{%s}\n' "$(entry s "$L" root)" >"$REG/stale-live.json"                        # older than the TTL, folder there
printf '{%s}\n' "$(entry s "$G" cwd)" >"$REG/old-gone.json"                           # old format, cwd gone
printf '{%s}\n' "$(entry s "$L/sub" cwd)" >"$REG/old-live.json"; mkdir -p "$L/sub"     # old format, cwd there
printf '{%s,%s}\n' "$(entry a "$G" root)" "$(entry b "$L" root)" >"$REG/mixed.json"    # one gone, one live
printf '{}\n' >"$REG/empty.json"
printf 'not json {\n' >"$REG/broken.json"
printf '[]\n' >"$REG/array.json"
printf '{%s}\n' "$(entry s "relative/gone" root)" >"$REG/relative.json"               # folder cannot be decided
printf '{%s,"x":5}\n' "$(entry s "$G" root)" >"$REG/odd-entry.json"                   # an entry with no folder
printf '{%s,%s}\n' "$(entry a "$G" root)" "$(entry b "$G/deeper" cwd)" >"$REG/all-gone.json"
if [ "$WIN" -eq 1 ]; then
    # The spelling Claude Code passes on Windows: a drive letter and backslashes.
    printf '{%s}\n' "$(entry s "${G//\//\\\\}" root)" >"$REG/win-gone.json"
    printf '{%s}\n' "$(entry s "${L//\//\\\\}" root)" >"$REG/win-live.json"
fi
before_broken="$(cat "$REG/broken.json")"
total="$(json_files "$REG")"; want=3; [ "$WIN" -eq 1 ] && want=4
out="$(prune "$H" 2>&1)"; rc=$?
check "prune: 'removed $want of $total registry files' (exit 0)" holds '[ "$rc" -eq 0 ] && [ "$out" = "removed $want of $total registry files" ]'
check "an existing tree whose entries are older than the TTL keeps its file" [ -e "$REG/stale-live.json" ]
check "an old entry without root whose cwd is gone: file removed" [ ! -e "$REG/old-gone.json" ]
check "an old entry without root whose cwd exists: file kept" [ -e "$REG/old-live.json" ]
check "one gone folder and one live folder: the file stays whole" holds '[ -e "$REG/mixed.json" ] && [ "$(roots "$REG/mixed.json")" = "$G,$L" ]'
check "an empty registry file {}: removed" [ ! -e "$REG/empty.json" ]
check "a file that is not JSON is not touched" holds '[ -e "$REG/broken.json" ] && [ "$(cat "$REG/broken.json")" = "$before_broken" ]'
check "a JSON array is not touched" [ -e "$REG/array.json" ]
check "a relative folder cannot be decided: file kept" [ -e "$REG/relative.json" ]
check "an entry that is not an object keeps the file" [ -e "$REG/odd-entry.json" ]
check "every folder gone (root and old cwd): file removed" [ ! -e "$REG/all-gone.json" ]
if [ "$WIN" -eq 1 ]; then
    check "Windows: root with a drive letter and backslashes, gone: file removed" [ ! -e "$REG/win-gone.json" ]
    check "Windows: root with a drive letter and backslashes, there: file kept" [ -e "$REG/win-live.json" ]
fi

# --- 3. The file's mutex ----------------------------------------------------------------------------------
H="$T/c3"; REG="$H/worktree-sessions"; mkdir -p "$REG"
printf '{}\n' >"$REG/busy.json"; mkdir "$REG/busy.json.lock"
printf '{}\n' >"$REG/crashed.json"; mkdir "$REG/crashed.json.lock"
node -e 'const t = Date.now() / 1000 - 3600; require("node:fs").utimesSync(process.argv[1], t, t)' "$REG/crashed.json.lock"
out="$(prune "$H" 2>&1)"; rc=$?
check "a busy mutex (a fresh <file>.lock): file not touched, the mutex left alone" holds '[ -e "$REG/busy.json" ] && [ -d "$REG/busy.json.lock" ]'
check "a mutex an hour old is a crashed process's: file removed, its mutex too" holds '[ ! -e "$REG/crashed.json" ] && [ ! -e "$REG/crashed.json.lock" ]'
check "prune: 'removed 1 of 2 registry files' (exit 0)" holds '[ "$rc" -eq 0 ] && [ "$out" = "removed 1 of 2 registry files" ]'

# --- 4. Checked again under the mutex: a tree re-created after the first check keeps its file -----------
# WORKTREE_LOCK_PRUNE_PAUSE stops prune after a file passed its first check (<pause>.ready) until <pause>.go
# exists: the folder comes back in that window, as a claim in a tree re-created at the same path would.
race() { # $1 = case folder, $2 = "back" to re-create the tree in the window; prints prune's output
    local reg="$1/worktree-sessions" pause="$1/pause" i=0 pid
    (cd "$T" && WORKTREE_LOCK_PRUNE_PAUSE="$pause" wl "$1" prune </dev/null >"$1/out" 2>&1) &
    pid=$!
    while [ ! -e "$pause.ready" ] && [ "$i" -lt 500 ]; do sleep 0.02; i=$((i + 1)); done
    [ "$2" = back ] && mkdir -p "$1-tree"
    : >"$pause.go"
    wait "$pid"
    cat "$1/out"
}
H="$T/c4"; mkdir -p "$H/worktree-sessions"
printf '{%s}\n' "$(entry s "$H-tree" root)" >"$H/worktree-sessions/race.json"
out="$(race "$H" back)"
check "the tree is back when the mutex is taken: file kept, 'removed 0 of 1 registry files'" holds '[ -e "$H/worktree-sessions/race.json" ] && [ "$out" = "removed 0 of 1 registry files" ] && [ -e "$H/pause.ready" ]'
H="$T/c4b"; mkdir -p "$H/worktree-sessions"
printf '{%s}\n' "$(entry s "$H-tree" root)" >"$H/worktree-sessions/race.json"
out="$(race "$H" stays-gone)"
check "the same pause with the tree still gone: file removed" holds '[ ! -e "$H/worktree-sessions/race.json" ] && [ "$out" = "removed 1 of 1 registry files" ]'

# --- 5. claim prunes once a day -----------------------------------------------------------------------
H="$T/c5"; REG="$H/worktree-sessions"; A="$T/c5-trees/a"; B="$T/c5-trees/b"
tree "$A"; tree "$B"; mkdir -p "$REG"
printf '{%s}\n' "$(entry s "$T/c5-trees/gone1" root)" >"$REG/dead1.json"
out="$(claim "$H" "$A" s5 2>&1)"; rc=$?
check "claim in another tree: exit 0, empty stdout" holds '[ "$rc" -eq 0 ] && [ -z "$out" ]'
check "claim in another tree removes the file of a deleted tree and sets the mark .pruned" holds '[ ! -e "$REG/dead1.json" ] && [ -e "$REG/.pruned" ]'
check "claim keeps its own tree's file" [ "$(json_files "$REG")" = 1 ]
printf '{%s}\n' "$(entry s "$T/c5-trees/gone2" root)" >"$REG/dead2.json"
claim "$H" "$B" s5b >/dev/null 2>&1
check "a second claim the same day does not prune: the deleted tree's file made after the first stays" [ -e "$REG/dead2.json" ]
node -e 'const t = Date.now() / 1000 - 25 * 3600; require("node:fs").utimesSync(process.argv[1], t, t)' "$REG/.pruned"
claim "$H" "$B" s5b >/dev/null 2>&1
check "a mark older than a day: the next claim prunes again" [ ! -e "$REG/dead2.json" ]

# --- 6. An unreadable registry folder: claim stays silent ---------------------------------------------
# chmod does not take a read right away on Windows, and root reads anything.
if [ "$WIN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
    H="$T/c6"; REG="$H/worktree-sessions"; A="$T/c6-trees/a"
    tree "$A"
    claim "$H" "$A" s6 >/dev/null 2>&1
    rm -f "$H/worktree-sessions/.pruned"
    chmod 300 "$REG"   # no read: the listing prune needs fails
    out="$(claim "$H" "$A" s6 2>&1)"; rc=$?
    chmod 700 "$REG"
    check "the registry folder cannot be read: claim exit 0, empty stdout and stderr" holds '[ "$rc" -eq 0 ] && [ -z "$out" ]'
    check "the folder could not be listed after the mark was set (prune ran and failed silently)" [ -e "$REG/.pruned" ]
    check "the tree's file is still there" [ "$(json_files "$REG")" = 1 ]
else
    echo "skip unreadable registry folder: Windows or root"
fi

# --- 7. usage and the header name prune -----------------------------------------------------------------
check "usage names prune" grep -q 'claim|beat|release|status|prune>' "$BIN/worktree-lock"
check "the header names prune" grep -q '^//   prune ' "$BIN/worktree-lock"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
