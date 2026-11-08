#!/usr/bin/env bash
# worktree-lock removes the registry files of working trees that are gone ($HARNESS_HOME/worktree-sessions):
#   1. `worktree-lock prune` removes a file when every entry names a folder that does not exist (root; for an
#      entry written before root was recorded, the folder at or above its cwd whose slug is the file's name; no
#      such folder keeps the file) or when the file has no entries, and prints
#      "removed N of M registry files".
#   2. It keeps a file with at least one existing folder (also when its entries are older than the TTL), a
#      file that is not a JSON object, a file with an entry whose folder cannot be decided, and a file whose
#      mutex is busy, without waiting for it.
#   3. The removal re-reads the file and checks the folders again under the mutex: a tree re-created between
#      the first check and the mutex keeps its file.
#   4. claim prunes at most once a day (the mtime of worktree-sessions/.pruned), and an unreadable registry
#      folder leaves claim at exit 0 with an empty stdout.
#   5. An entry written by claim or beat carries root, the top folder of the tree.
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
# The registry file name of a tree, as worktree-lock spells it (slugOf).
slug() { node -e 'const r = process.argv[1]; process.stdout.write(`${r.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${require("node:crypto").createHash("sha1").update(r).digest("hex").slice(0, 8)}`)' "$1"; }
# Runs worktree-lock prune with HARNESS_HOME $1 in the background and gives it 10 s: prune never waits for a
# busy mutex, and one that does (until the mutex grows stale, 15 s) fails here instead of hanging the test.
# Sets out, rc and finished (yes or no).
bounded_prune() {
    local i=0 pid
    (cd "$T" && exec env -u EVAL_HARNESS_HOME -u EVAL_GIT HOME="$T/home" USERPROFILE="$T/home" HARNESS_HOME="$1" \
        node "$BIN/worktree-lock" prune </dev/null >"$1/out" 2>&1) &
    pid=$!
    while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 500 ]; do sleep 0.02; i=$((i + 1)); done
    if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null; finished=no; else finished=yes; fi
    wait "$pid"; rc=$?
    out="$(cat "$1/out")"
}
json_files() { find "$1" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' '; }
roots() { node -e 'const o = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(Object.values(o).map((e) => e.root).join(","))' "$1"; }

# --- 1. A deleted tree: prune removes its file; the entry claim wrote carries root ------------------------
H="$T/c1"; REG="$H/worktree-sessions"; A="$T/c1-trees/a"
tree "$A"
claim "$H" "$A" s1 >/dev/null 2>&1
f="$(ls "$REG"/*.json 2>/dev/null)"
check "claim: one registry file for the tree" [ "$(json_files "$REG")" = 1 ]
top="$(git -C "$A" rev-parse --show-toplevel)"
check "claim: the entry carries root, the tree's top folder" holds '[ -n "$f" ] && [ "$(roots "$f")" = "$top" ]'
mkdir -p "$A/sub"
(cd "$A/sub" && printf '{"session_id":"s1b","cwd":"%s"}' "$A/sub" | wl "$H" beat >/dev/null 2>&1)
check "beat from a folder inside the tree: its entry carries root, the tree's top folder" holds '[ "$(roots "$f")" = "$top,$top" ]'
rm -rf "$T/c1-trees/a"
out="$(prune "$H" 2>&1)"; rc=$?
check "prune: a deleted tree's file is removed, 'removed 1 of 1 registry files' (exit 0)" holds '[ "$rc" -eq 0 ] && [ "$out" = "removed 1 of 1 registry files" ] && [ ! -e "$f" ]'

# --- 2. What stays, what goes: one registry, many files ---------------------------------------------------
H="$T/c2"; REG="$H/worktree-sessions"; L="$T/c2-trees/live"; G="$T/c2-trees/gone"
tree "$L"; mkdir -p "$REG"
printf '{%s}\n' "$(entry s "$L" root)" >"$REG/stale-live.json"                        # older than the TTL, folder there
# The old format (no root): the folder is cwd or the folder above it whose slug is the file's name.
G2="$T/c2-trees/gone2"
printf '{%s}\n' "$(entry s "$G/sub" cwd)" >"$REG/$(slug "$G").json"                    # cwd and its tree gone
printf '{%s}\n' "$(entry s "$L/sub" cwd)" >"$REG/$(slug "$L").json"                    # cwd gone, its tree there
printf '{%s}\n' "$(entry s "$G/sub" cwd)" >"$REG/no-ancestor.json"                     # no folder above has this name
printf '{%s,%s}\n' "$(entry a "$G" root)" "$(entry b "$L" root)" >"$REG/mixed.json"    # one gone, one live
printf '{}\n' >"$REG/empty.json"
printf 'not json {\n' >"$REG/broken.json"
printf '[]\n' >"$REG/array.json"
printf '{%s}\n' "$(entry s "relative/gone" root)" >"$REG/relative.json"               # folder cannot be decided
printf '{%s,"x":5}\n' "$(entry s "$G" root)" >"$REG/odd-entry.json"                   # an entry with no folder
printf '{%s,%s}\n' "$(entry a "$G2" root)" "$(entry b "$G2/deeper" cwd)" >"$REG/$(slug "$G2").json"
if [ "$WIN" -eq 1 ]; then
    # The spelling Claude Code passes on Windows: a drive letter and backslashes; git names the tree C:/….
    G3="$T/c2-trees/gone3"; L3="$T/c2-trees/live3"; mkdir -p "$L3"
    printf '{%s}\n' "$(entry s "${G//\//\\\\}" root)" >"$REG/win-gone.json"
    printf '{%s}\n' "$(entry s "${L//\//\\\\}" root)" >"$REG/win-live.json"
    printf '{%s}\n' "$(entry s "${G3//\//\\\\}\\\\sub" cwd)" >"$REG/$(slug "$G3").json"
    printf '{%s}\n' "$(entry s "${L3//\//\\\\}\\\\sub" cwd)" >"$REG/$(slug "$L3").json"
fi
before_broken="$(cat "$REG/broken.json")"
total="$(json_files "$REG")"; want=3; [ "$WIN" -eq 1 ] && want=5
out="$(prune "$H" 2>&1)"; rc=$?
check "prune: 'removed $want of $total registry files' (exit 0)" holds '[ "$rc" -eq 0 ] && [ "$out" = "removed $want of $total registry files" ]'
check "an existing tree whose entries are older than the TTL keeps its file" [ -e "$REG/stale-live.json" ]
check "an old entry without root, its cwd and its tree gone: file removed" [ ! -e "$REG/$(slug "$G").json" ]
check "an old entry without root, cwd (a subfolder) gone but the tree there: file kept" [ -e "$REG/$(slug "$L").json" ]
check "an old entry without root, no folder above cwd has the file's name: file kept" [ -e "$REG/no-ancestor.json" ]
check "one gone folder and one live folder: the file stays whole" holds '[ -e "$REG/mixed.json" ] && [ "$(roots "$REG/mixed.json")" = "$G,$L" ]'
check "an empty registry file {}: removed" [ ! -e "$REG/empty.json" ]
check "a file that is not JSON is not touched" holds '[ -e "$REG/broken.json" ] && [ "$(cat "$REG/broken.json")" = "$before_broken" ]'
check "a JSON array is not touched" [ -e "$REG/array.json" ]
check "a relative folder cannot be decided: file kept" [ -e "$REG/relative.json" ]
check "an entry that is not an object keeps the file" [ -e "$REG/odd-entry.json" ]
check "every folder gone (root and old cwd): file removed" [ ! -e "$REG/$(slug "$G2").json" ]
if [ "$WIN" -eq 1 ]; then
    check "Windows: root with a drive letter and backslashes, gone: file removed" [ ! -e "$REG/win-gone.json" ]
    check "Windows: root with a drive letter and backslashes, there: file kept" [ -e "$REG/win-live.json" ]
    check "Windows: old cwd with backslashes, its tree (named C:/…) gone: file removed" [ ! -e "$REG/$(slug "$G3").json" ]
    check "Windows: old cwd with backslashes, its tree there: file kept" [ -e "$REG/$(slug "$L3").json" ]
fi

# --- 3. The file's mutex ----------------------------------------------------------------------------------
H="$T/c3"; REG="$H/worktree-sessions"; mkdir -p "$REG"
printf '{}\n' >"$REG/busy.json"; mkdir "$REG/busy.json.lock"
printf '{}\n' >"$REG/crashed.json"; mkdir "$REG/crashed.json.lock"
node -e 'const t = Date.now() / 1000 - 3600; require("node:fs").utimesSync(process.argv[1], t, t)' "$REG/crashed.json.lock"
bounded_prune "$H"
check "prune does not wait for a busy mutex (finished within 10 s)" [ "$finished" = yes ]
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
printf '{%s}\n' "$(entry s "$T/c5-trees/gone3" root)" >"$REG/dead3.json"
node -e 'const t = Date.now() / 1000 + 48 * 3600; require("node:fs").utimesSync(process.argv[1], t, t)' "$REG/.pruned"
claim "$H" "$B" s5b >/dev/null 2>&1
check "a mark dated two days ahead (a clock moved back) counts as old: claim prunes" [ ! -e "$REG/dead3.json" ]

# --- 5b. claim spends at most 200 ms on the pass; the rest waits for the next one ------------------------
# The pause holds the pass after the first prunable file's first check for 0.3 s, past the 200 ms budget
# that started before it: that file still goes, the other one waits.
H="$T/c5b"; REG="$H/worktree-sessions"; A="$T/c5b-trees/a"; pause="$H/pause"
tree "$A"; mkdir -p "$REG"
printf '{}\n' >"$REG/dead-a.json"; printf '{}\n' >"$REG/dead-b.json"
(cd "$A" && printf '{"session_id":"s5c","cwd":"%s"}' "$A" | WORKTREE_LOCK_PRUNE_PAUSE="$pause" wl "$H" claim >/dev/null 2>&1) &
pid=$!; i=0
while [ ! -e "$pause.ready" ] && [ "$i" -lt 500 ]; do sleep 0.02; i=$((i + 1)); done
sleep 0.3
: >"$pause.go"
wait "$pid"
left=0; [ -e "$REG/dead-a.json" ] && left=$((left + 1)); [ -e "$REG/dead-b.json" ] && left=$((left + 1))
check "past the 200 ms budget: one of two empty files removed, the other left for next time" holds '[ -e "$pause.ready" ] && [ "$left" = 1 ]'

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
    chmod 300 "$REG"
    out="$(prune "$H" 2>&1)"; rc=$?
    chmod 700 "$REG"
    check "worktree-lock prune by hand on an unreadable folder: exit 1, one line 'worktree-lock: ...'" \
        holds '[ "$rc" -eq 1 ] && [ "$(printf "%s\n" "$out" | wc -l | tr -d " ")" = 1 ] && [ "${out#worktree-lock: }" != "$out" ]'
    # A tree under a folder nobody may enter: stat answers EACCES, not ENOENT, and the file stays.
    P="$T/c6-locked"; mkdir -p "$P/tree"
    printf '{%s}\n' "$(entry s "$P/tree" root)" >"$REG/locked.json"
    chmod 000 "$P"
    prune "$H" >/dev/null 2>&1
    chmod 700 "$P"
    check "a tree folder that cannot be checked (EACCES on stat): file kept" [ -e "$REG/locked.json" ]
else
    echo "skip unreadable registry folder and EACCES: Windows or root"
fi

# --- 7. usage and the header name prune -----------------------------------------------------------------
check "usage names prune" grep -q 'claim|beat|release|status|prune>' "$BIN/worktree-lock"
check "the header names prune" grep -q '^//   prune ' "$BIN/worktree-lock"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
