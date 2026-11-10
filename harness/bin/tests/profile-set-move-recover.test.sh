#!/usr/bin/env bash
# Tests of `harness/bin/profile-set --move` beyond the plain move (profile-set-move.test.sh has that): where the
# Workflow folder may not be (reached through a link into the repository, made inside another repository),
# the refusals of a detached HEAD and of a file already at the new place, the folder of a spec template outside
# tickets.root, a file the receiving side's .gitignore ignores (moved with `git add -f` and named), git run with
# the caller's config (GIT_CONFIG_GLOBAL kept, so a rollback writes the bytes the caller's git expects), and a
# move killed at each step: the marker it leaves, `--read` printing interrupted, the next move rolling it back
# (or closing it when the profile was written), and a refusal naming the marker once a side moved on since.
# Run: bash harness/bin/tests/profile-set-move-recover.test.sh; exit code 0 — everything passed.
#
# Everything runs in a temporary HOME and HARNESS_HOME; gh is always a node stand-in ($PROFILE_SET_GH) that
# prints an empty list, with no credential. The real ~/.claude and ~/.claude/worfy-harness are compared
# before and after (real-home.sh).
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
SET="$BIN/profile-set"
PROFILE="$BIN/profile"
pass=0
fail=0
. "$(dirname "$0")/real-home.sh"
REAL_HOME="$HOME"
home_before="$(real_home_snapshot "$REAL_HOME")"

ok() {
    pass=$((pass + 1))
    echo "ok   $1"
}
bad() {
    fail=$((fail + 1))
    # On the FAIL line itself: a runner of these tests prints only the FAIL lines and the last 20 lines.
    local status="" said=""
    [ -n "${R:-}" ] && [ -d "$R" ] && status="$(git -C "$R" status --porcelain --untracked-files=all 2>&1 | head -5 | tr '\n' ' ')"
    [ -s "${T:-}/err" ] && said="$(head -c 300 "$T/err" | tr '\n' ' ')"
    echo "FAIL $1 [status: ${status}] [stderr: ${said}]"
    return 0
}
check() {
    local name="$1"
    shift
    if "$@"; then ok "$name"; else bad "$name"; fi
}

T="$(mktemp -d)"
T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
H="$T/home"
HH="$T/hh"
R="$T/r/demo"
mkdir -p "$H" "$HH/gate" "$HH/projects/demo" "$R" "$T/ghcfg"

g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=main "$@"; }

# A Full mode project: tickets, a spec template outside tickets.root, the state file, ADRs with a picture.
g -C "$R" init -q
mkdir -p "$R/.scratch/epic-a/issues" "$R/plans/epic-a" "$R/docs/adr" "$R/src"
printf '# 01 — one\n\nStatus: open\n' >"$R/.scratch/epic-a/issues/01-one.md"
printf '# spec\n' >"$R/plans/epic-a/spec.md"
printf '# state\nline two\n' >"$R/HANDOFF.md"
printf '# 0001 — a decision\n' >"$R/docs/adr/0001-a.md"
printf 'not really a png\n' >"$R/docs/adr/d.png"
# A file whose bytes on disk are not what git stores (eol=crlf: CRLF on disk, LF in the blob), and a symlink: a copy
# of each holds the bytes of the original, which git's view of the copy (hash-object) does not match.
printf 'docs/adr/crlf.md text eol=crlf\n' >"$R/.gitattributes"
printf '# crlf\r\nline two\r\n' >"$R/docs/adr/crlf.md"
ln -s 0001-a.md "$R/docs/adr/link.md"
printf 'code\n' >"$R/src/a.txt"
g -C "$R" add -A
g -C "$R" commit -q -m init
g -C "$R" config user.name t
g -C "$R" config user.email t@t

cat >"$HH/gate/config.json" <<EOF
{"repos":[{"key":"demo","match":"$R","profile":"demo"}]}
EOF
cat >"$HH/projects/demo/profile.json" <<'EOF'
{
  "schema": 2,
  "name": "demo",
  "mode": "full",
  "tickets": { "root": ".scratch", "path": ".scratch/<epic>/issues/NN-*.md", "spec": "plans/<epic>/spec.md", "branch": "<epic>/<NN>" },
  "workflow": { "folder": null },
  "docs": { "adr_dir": "docs/adr", "handoff": { "path": "HANDOFF.md" } }
}
EOF
printf '/*\n!/.gitignore\n!/projects/\n/projects/*/workflow/\n!/gate/\n/gate/*\n!/gate/config.json\n' >"$HH/.gitignore"
g -C "$HH" init -q
g -C "$HH" add -A
g -C "$HH" commit -q -m init
PJ="$HH/projects/demo/profile.json"
WF="$HH/projects/demo/workflow"
MARKER="$HH/projects/demo/.move-in-progress.json"

GH="$T/gh-stand-in.mjs"
# It refuses to answer under a GIT_DIR: gh runs git, and an inherited GIT_DIR points it at another repository.
# With GH_SLEEP_MS it answers that much later, as a slow network would.
printf 'if (process.env.GIT_DIR) { process.stderr.write("GIT_DIR is set\\n"); process.exit(1) }\nif (process.env.GH_SLEEP_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.GH_SLEEP_MS))\nprocess.stdout.write("[]")\n' >"$GH"
run() {
    env -u CLAUDE_GATE_CONFIG -u CLAUDE_PROFILES_DIR -u EVAL_HARNESS_HOME -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN \
        HOME="$H" USERPROFILE="$H" HARNESS_HOME="$HH" PROFILE_SET_GH="$GH" GH_TOKEN=invalid GH_CONFIG_DIR="$T/ghcfg" "$@"
}
json_get() { node -e 'const v=JSON.parse(require("fs").readFileSync(0,"utf8"))[process.argv[1]]; process.stdout.write(v===undefined?"undefined":v===null?"null":typeof v==="string"?v:JSON.stringify(v))' "$1"; }
fp() { run "$SET" -C "$R" --field mode --field workflow.folder --read | json_get fingerprint; }
mode_now() { run "$PROFILE" -C "$R" --field mode; }
clean() { for d; do [ -z "$(git -C "$d" status --porcelain --untracked-files=all)" ] || return 1; done; }
present() { for f; do [ -e "$f" ] || return 1; done; }
absent() { for f; do [ ! -e "$f" ] || return 1; done; }
count() { git -C "$1" rev-list --count HEAD; }
# back_to_full <label>: the project moved back to Full mode, so the next case starts as the first did.
back_to_full() {
    run "$SET" -C "$R" --expect "$(fp)" --move full >/dev/null 2>"$T/err"
    check "$1: moved back to Full mode" [ "$(mode_now)" = full ]
}

# --- refusals of the Workflow folder's place ---------------------------------------------------------------
check "no move under way: --read has no interrupted" [ "$(run "$SET" -C "$R" --field mode --field workflow.folder --read | json_get interrupted)" = undefined ]
FP="$(fp)"
repo_head="$(git -C "$R" rev-parse HEAD)"

# A link (a junction on Windows, which needs no rights) to the repository: the folder under it is inside it.
node -e 'require("fs").symlinkSync(process.argv[1], process.argv[2], "junction")' "$R" "$T/link"
run "$SET" -C "$R" --expect "$FP" --move silent --folder "$T/link/wf" >"$T/out" 2>"$T/err"
check "a folder reached through a link into the repository: exit 1" [ $? -eq 1 ]
check "through a link: the reason" grep -q "outside the project's repository" "$T/err"
check "through a link: nothing made in the repository" absent "$R/wf"
check "through a link: the repository clean" clean "$R"

mkdir -p "$T/other"
g -C "$T/other" init -q
g -C "$T/other" commit -q --allow-empty -m init
run "$SET" -C "$R" --expect "$FP" --move silent --folder "$T/other/sub/wf" >/dev/null 2>"$T/err"
check "a missing folder inside another repository: exit 1" [ $? -eq 1 ]
check "inside another repository: the reason names it" grep -q "would be made inside the git repository" "$T/err"
check "inside another repository: nothing made" absent "$T/other/sub"
mkdir -p "$T/other/empty"
run "$SET" -C "$R" --expect "$FP" --move silent --folder "$T/other/empty" >/dev/null 2>"$T/err"
check "an empty folder inside another repository: exit 1" [ $? -eq 1 ]
check "an empty folder inside another repository: no git init there" absent "$T/other/empty/.git"

g -C "$R" checkout -q --detach
run "$SET" -C "$R" --expect "$FP" --move silent >/dev/null 2>"$T/err"
check "a detached HEAD in the repository: exit 1" [ $? -eq 1 ]
check "a detached HEAD: the reason" grep -q "detached HEAD" "$T/err"
g -C "$R" checkout -q main
check "a detached HEAD: no Workflow folder made" absent "$WF"

g -C "$R" config status.showUntrackedFiles no
printf 'new\n' >"$R/src/untracked.txt"
run "$SET" -C "$R" --expect "$FP" --move silent >/dev/null 2>"$T/err"
check "an untracked file hidden by status.showUntrackedFiles=no: exit 1" [ $? -eq 1 ]
check "an untracked file hidden by the config: the reason" grep -q "the repository has uncommitted changes" "$T/err"
rm -f "$R/src/untracked.txt"
g -C "$R" config --unset status.showUntrackedFiles

mkdir -p "$T/pre"
g -C "$T/pre" init -q
printf 'theirs\n' >"$T/pre/HANDOFF.md"
g -C "$T/pre" add -A
g -C "$T/pre" commit -q -m init
run "$SET" -C "$R" --expect "$FP" --move silent --folder "$T/pre" >/dev/null 2>"$T/err"
check "a file already at the new place: exit 1" [ $? -eq 1 ]
check "already at the new place: the reason names it" grep -q "HANDOFF.md is already in the Workflow folder" "$T/err"
check "already at the new place: their file untouched" [ "$(cat "$T/pre/HANDOFF.md")" = theirs ]
check "the refusals: no commit in the repository" [ "$(git -C "$R" rev-parse HEAD)" = "$repo_head" ]
check "the refusals: still Full mode" [ "$(mode_now)" = full ]

# --- a GIT_DIR inherited from a surrounding git hook --------------------------------------------------------------
g -C "$R" remote add origin https://example.invalid/demo.git
# (Its own repository's: one of another repository already stops bin/profile from finding the project.)
GIT_DIR="$R/.git" PROFILE_SET_MOVE_FAIL_AT=copy run "$SET" -C "$R" --expect "$FP" --move silent >/dev/null 2>"$T/err"
check "an inherited GIT_DIR: gh asked without it, the move went on to its failure at copy" grep -q "failed at copy" "$T/err"
check "an inherited GIT_DIR: the repository clean, still Full mode" bash -c "[ -z \"\$(git -C '$R' status --porcelain --untracked-files=all)\" ] && [ \"\$1\" = full ]" _ "$(mode_now)"

# --- the lock of a long move stays fresh ---------------------------------------------------------------------------
# A move blocked longer than the lock's stale limit (gh slow to answer): another writer meanwhile finds the lock
# live (exit 6), not stale. With a 2 s limit, the keeper touches the owner file every 0.5 s.
title_fp="$(run "$SET" -C "$R" --field title --read | json_get fingerprint)"
PROFILE_SET_LOCK_STALE_MS=2000 GH_SLEEP_MS=7000 PROFILE_SET_MOVE_FAIL_AT=copy run "$SET" -C "$R" --expect "$(fp)" --move silent >/dev/null 2>"$T/err-slow" &
slow=$!
sleep 4
PROFILE_SET_LOCK_STALE_MS=2000 PROFILE_SET_LOCK_WAIT_MS=500 run "$SET" -C "$R" --field title --expect "$title_fp" --set '{"title":"Other"}' >/dev/null 2>"$T/err"
check "a long move: another writer finds its lock live (exit 6)" [ $? -eq 6 ]
wait "$slow"
check "a long move: it went on to its failure at copy" grep -q "failed at copy" "$T/err-slow"
check "a long move: no keeper left on the lock" absent "$HH/projects/demo/.profile-set.lock"

# --- git with the caller's config ----------------------------------------------------------------------------
# HOME's config asks for CRLF, GIT_CONFIG_GLOBAL (the caller's) does not: a rollback must write what the caller's
# git reads as unchanged. Dropping GIT_CONFIG_* made git read another config than the caller's (Windows CI).
printf '[core]\n\tautocrlf = true\n' >"$H/.gitconfig"
: >"$T/plain.gitconfig"
GIT_CONFIG_GLOBAL="$T/plain.gitconfig" PROFILE_SET_MOVE_FAIL_AT=profile run "$SET" -C "$R" --expect "$FP" --move silent >/dev/null 2>"$T/err"
check "the caller's git config: the failed move exits 1" [ $? -eq 1 ]
check "the caller's git config: the restored state file has no CR" bash -c "! grep -q \$'\\r' '$R/HANDOFF.md'"
check "the caller's git config: the repository clean to the caller" env GIT_CONFIG_GLOBAL="$T/plain.gitconfig" bash -c "[ -z \"\$(git -C '$R' status --porcelain --untracked-files=all)\" ]"
rm -f "$H/.gitconfig"

# --- a move killed at each step, rolled back by the next one --------------------------------------------------
for at in copy to-commit from-commit profile; do
    FP="$(fp)"
    # The first kill is in a Workflow folder the move makes; the later ones in the one the moves back left.
    wf_before=0
    [ -d "$WF/.git" ] && wf_before="$(count "$WF")"
    PROFILE_SET_MOVE_KILL_AT="$at" run "$SET" -C "$R" --expect "$FP" --move silent >/dev/null 2>"$T/err"
    check "killed at $at: exit 137" [ $? -eq 137 ]
    check "killed at $at: the marker left" present "$MARKER"
    check "killed at $at: still Full mode" [ "$(mode_now)" = full ]
    check "killed at $at: --read prints interrupted" [ "$(run "$SET" -C "$R" --field mode --field workflow.folder --read | json_get interrupted)" = true ]
    check "killed at $at: no lock left" absent "$HH/projects/demo/.profile-set.lock"
    out="$(run "$SET" -C "$R" --expect "$FP" --move silent 2>"$T/err")"
    check "killed at $at: the next move exits 0" [ $? -eq 0 ]
    check "killed at $at: the next move rolled it back first" [ "$(json_get moved <<<"$out" | json_get recovered)" = rolled-back ]
    check "killed at $at: Silent mode now" [ "$(mode_now)" = silent ]
    check "killed at $at: the marker gone" absent "$MARKER"
    check "killed at $at: the files in the Workflow folder, once" present "$WF/HANDOFF.md" "$WF/plans/epic-a/spec.md" "$WF/.scratch/epic-a/issues/01-one.md"
    check "killed at $at: one commit more in the Workflow folder" [ "$(count "$WF")" -eq $((wf_before + 1)) ]
    check "killed at $at: none left in the repository" absent "$R/HANDOFF.md" "$R/plans" "$R/.scratch"
    check "killed at $at: both sides clean" clean "$R" "$WF"
    back_to_full "killed at $at"
done
check "the spec folder outside tickets.root moved back too" present "$R/plans/epic-a/spec.md"

# Copies whose bytes git would write otherwise (a symlink, an eol=crlf file) are the move's own copies: a kill
# before their commit is rolled back. One changed byte (CRLF made LF) is a person's change and refuses.
kill_at_plain() {
    PROFILE_SET_MOVE_KILL_AT="$1" run "$SET" -C "$R" --expect "$(fp)" --move silent >/dev/null 2>"$T/err"
    check "killed at $1 with a symlink and an eol=crlf file: exit 137" [ $? -eq 137 ]
}
kill_at_plain to-commit
check "the copies: the eol=crlf file has its CRLF bytes" cmp -s "$R/docs/adr/crlf.md" "$WF/docs/adr/crlf.md"
if [ -L "$R/docs/adr/link.md" ]; then check "the copies: the symlink copied as a symlink" [ -L "$WF/docs/adr/link.md" ]; fi
out="$(run "$SET" -C "$R" --expect "$(fp)" --move silent 2>"$T/err")"
check "a symlink and an eol=crlf file in the copies: the next move rolls back and moves" [ "$(json_get moved <<<"$out" | json_get recovered)" = rolled-back ]
back_to_full "a symlink and an eol=crlf file"
kill_at_plain to-commit
printf '# crlf\nline two\r\n' >"$WF/docs/adr/crlf.md"
run "$SET" -C "$R" --expect "$(fp)" --move silent >/dev/null 2>"$T/err"
check "one byte of a copy changed: the next move exits 1" [ $? -eq 1 ]
check "one byte of a copy changed: the reason names it" grep -q "docs/adr/crlf.md" "$T/err"
check "one byte of a copy changed: the marker kept" present "$MARKER"
cp "$R/docs/adr/crlf.md" "$WF/docs/adr/crlf.md"
out="$(run "$SET" -C "$R" --expect "$(fp)" --move silent 2>"$T/err")"
check "the byte put back by hand: the next move rolls back and moves" [ "$(json_get moved <<<"$out" | json_get recovered)" = rolled-back ]
back_to_full "the byte put back by hand"
# The symlink of a copy replaced by a file with its target's bytes: not the move's copy (links are never followed).
if [ -L "$R/docs/adr/link.md" ]; then
    kill_at_plain to-commit
    rm -f "$WF/docs/adr/link.md"
    cp "$R/docs/adr/0001-a.md" "$WF/docs/adr/link.md"
    run "$SET" -C "$R" --expect "$(fp)" --move silent >/dev/null 2>"$T/err"
    check "a symlink of a copy made a plain file: the next move exits 1" [ $? -eq 1 ]
    check "a symlink of a copy made a plain file: the reason names it" grep -q "docs/adr/link.md" "$T/err"
    rm -f "$WF/docs/adr/link.md"
    ln -s 0001-a.md "$WF/docs/adr/link.md"
    out="$(run "$SET" -C "$R" --expect "$(fp)" --move silent 2>"$T/err")"
    check "the symlink put back by hand: the next move rolls back and moves" [ "$(json_get moved <<<"$out" | json_get recovered)" = rolled-back ]
    back_to_full "the symlink put back by hand"
fi

# Killed once the profile was written: the next move only closes it.
FP="$(fp)"
PROFILE_SET_MOVE_KILL_AT=done run "$SET" -C "$R" --expect "$FP" --move silent >/dev/null 2>"$T/err"
check "killed after the profile was written: exit 137" [ $? -eq 137 ]
check "killed after the profile was written: Silent mode, the marker left" bash -c "[ \"\$1\" = silent ] && [ -e '$MARKER' ]" _ "$(mode_now)"
out="$(run "$SET" -C "$R" --expect "$(fp)" --move full 2>"$T/err")"
check "killed after the profile was written: the next move exits 0" [ $? -eq 0 ]
check "killed after the profile was written: closed, not rolled back" [ "$(json_get moved <<<"$out" | json_get recovered)" = finished ]
check "killed after the profile was written: Full mode, the files back" bash -c "[ \"\$1\" = full ] && [ -e '$R/HANDOFF.md' ] && [ ! -e '$MARKER' ]" _ "$(mode_now)"

# A side moved on since the kill: refused, the marker named and kept; put back by hand, the next move goes on.
FP="$(fp)"
PROFILE_SET_MOVE_KILL_AT=from-commit run "$SET" -C "$R" --expect "$FP" --move silent >/dev/null 2>"$T/err"
printf 'more\n' >>"$R/src/a.txt"
g -C "$R" commit -q -am "a person's commit"
run "$SET" -C "$R" --expect "$FP" --move silent >"$T/out" 2>"$T/err"
check "a side moved on since the kill: exit 1" [ $? -eq 1 ]
check "a side moved on: the reason names the marker" grep -q "move-in-progress.json" "$T/err"
check "a side moved on: what is left is on stdout" [ "$(json_get leftover <"$T/out")" != undefined ]
check "a side moved on: the marker kept" present "$MARKER"
g -C "$R" reset -q --hard HEAD~1
out="$(run "$SET" -C "$R" --expect "$FP" --move silent 2>"$T/err")"
check "put back by hand: the next move rolls back and moves" [ "$(json_get moved <<<"$out" | json_get recovered)" = rolled-back ]
back_to_full "put back by hand"

# --- a person's change after a kill: refused, the marker kept, nothing touched ------------------------------------
# kill_at <step> [args…]: a move to Silent mode killed at that step.
kill_at() {
    local at="$1"
    shift
    PROFILE_SET_MOVE_KILL_AT="$at" run "$SET" -C "$R" --expect "$(fp)" --move silent "$@" >/dev/null 2>"$T/err"
    check "killed at $at for the next case: exit 137" [ $? -eq 137 ]
}
# refused <label> <text the reason names> [args…]: the next move refuses, the marker stays, still Full mode.
refused() {
    local label="$1" text="$2"
    shift 2
    run "$SET" -C "$R" --expect "$(fp)" --move silent "$@" >"$T/out" 2>"$T/err"
    check "$label: the next move exits 1" [ $? -eq 1 ]
    check "$label: the reason names it" grep -qF "$text" "$T/err"
    check "$label: what is left is on stdout" [ "$(json_get leftover <"$T/out")" != undefined ]
    check "$label: the marker kept" present "$MARKER"
    check "$label: still Full mode" [ "$(mode_now)" = full ]
}

# recover_then_back <label>: the next move rolls the killed one back and moves; then back to Full mode.
recover_then_back() {
    out="$(run "$SET" -C "$R" --expect "$(fp)" --move silent 2>"$T/err")"
    check "$1: the next move rolls back and moves" [ "$(json_get moved <<<"$out" | json_get recovered)" = rolled-back ]
    back_to_full "$1"
}

# A Workflow folder of one's own, with a file of its own and a .gitignore.
mkdir -p "$T/g1"
g -C "$T/g1" init -q
printf 'mine\n' >"$T/g1/README.md"
printf '*.log\n' >"$T/g1/.gitignore"
g -C "$T/g1" add -A
g -C "$T/g1" commit -q -m init
g1_head="$(git -C "$T/g1" rev-parse HEAD)"

# The side the files came to, both sides committed: a person's new ticket file there.
kill_at profile --folder "$T/g1"
printf '# 02 — new\n' >"$T/g1/.scratch/epic-a/issues/02-new.md"
refused "a new file where the files came to" "02-new.md" --folder "$T/g1"
check "a new file where the files came to: the file kept" present "$T/g1/.scratch/epic-a/issues/02-new.md"
rm -f "$T/g1/.scratch/epic-a/issues/02-new.md"
# A file git does not see (ignored there) is not the move's either: the rollback deletes the move's files by name,
# never a folder whole, so it stays; the new move then finds .scratch there and refuses.
printf 'notes\n' >"$T/g1/.scratch/notes.log"
run "$SET" -C "$R" --expect "$(fp)" --move silent --folder "$T/g1" >"$T/out" 2>"$T/err"
check "an ignored file of a person: the next move rolled back, then refused" grep -q "is already in the Workflow folder" "$T/err"
check "an ignored file of a person: the marker gone" absent "$MARKER"
check "an ignored file of a person: it stays" present "$T/g1/.scratch/notes.log" "$T/g1/README.md"
check "an ignored file of a person: the move's files gone from there" absent "$T/g1/.scratch/epic-a" "$T/g1/HANDOFF.md" "$T/g1/docs"
check "an ignored file of a person: that side at its own commit, clean" bash -c "[ \"\$(git -C '$T/g1' rev-parse HEAD)\" = '$g1_head' ] && [ -z \"\$(git -C '$T/g1' status --porcelain --untracked-files=all)\" ]"
check "an ignored file of a person: the files back in the repository, clean" bash -c "[ -e '$R/HANDOFF.md' ] && [ -z \"\$(git -C '$R' status --porcelain --untracked-files=all)\" ]"
rm -f "$T/g1/.scratch/notes.log"
rmdir "$T/g1/.scratch"

# The side the files came to, committed there only: a person's edit of a moved file.
kill_at from-commit --folder "$T/g1"
printf 'edited\n' >>"$T/g1/HANDOFF.md"
refused "an edit where the files came to (committed)" "HANDOFF.md" --folder "$T/g1"
check "an edit where the files came to (committed): the edit kept" grep -q edited "$T/g1/HANDOFF.md"
g -C "$T/g1" checkout -q -- HANDOFF.md
out="$(run "$SET" -C "$R" --expect "$(fp)" --move silent --folder "$T/g1" 2>"$T/err")"
check "the edit undone by hand: the next move rolls back and moves" [ "$(json_get moved <<<"$out" | json_get recovered)" = rolled-back ]
back_to_full "the edit undone by hand"

# The move's own commit there, amended by a person with another file: not the move's commit any more.
kill_at from-commit --folder "$T/g1"
moved_commit="$(git -C "$T/g1" rev-parse HEAD)"
printf 'extra\n' >"$T/g1/extra.txt"
g -C "$T/g1" add extra.txt
g -C "$T/g1" commit -q --amend --no-edit
refused "the move's commit amended with another file" "changes files the move did not (extra.txt)" --folder "$T/g1"
g -C "$T/g1" reset -q --hard "$moved_commit"
out="$(run "$SET" -C "$R" --expect "$(fp)" --move silent --folder "$T/g1" 2>"$T/err")"
check "the amend undone by hand: the next move rolls back and moves" [ "$(json_get moved <<<"$out" | json_get recovered)" = rolled-back ]
back_to_full "the amend undone by hand"

# The copies cannot be unstaged there (another git holds the index): they are not deleted either, the marker stays,
# and once that git is done the next move finishes the rollback.
kill_at from-commit --folder "$T/g1"
: >"$T/g1/.git/index.lock"
run "$SET" -C "$R" --expect "$(fp)" --move silent --folder "$T/g1" >"$T/out" 2>"$T/err"
check "the index there held by another git: exit 1" [ $? -eq 1 ]
check "the index there held: what is left is on stdout" [ "$(json_get leftover <"$T/out")" != undefined ]
check "the index there held: the copies not deleted" present "$T/g1/HANDOFF.md" "$T/g1/.scratch/epic-a/issues/01-one.md"
check "the index there held: the marker kept" present "$MARKER"
rm -f "$T/g1/.git/index.lock"
out="$(run "$SET" -C "$R" --expect "$(fp)" --move silent --folder "$T/g1" 2>"$T/err")"
check "the index free again: the next move rolls back and moves" [ "$(json_get moved <<<"$out" | json_get recovered)" = rolled-back ]
back_to_full "the index free again"

# The side the files came to, before its commit: a person's edit of a copy.
kill_at to-commit
printf 'edited\n' >>"$WF/HANDOFF.md"
refused "an edit of a copy not yet committed" "HANDOFF.md"
check "an edit of a copy not yet committed: the edit kept" grep -q edited "$WF/HANDOFF.md"
cp "$R/HANDOFF.md" "$WF/HANDOFF.md"
out="$(run "$SET" -C "$R" --expect "$(fp)" --move silent 2>"$T/err")"
check "the copy put back by hand: the next move rolls back and moves" [ "$(json_get moved <<<"$out" | json_get recovered)" = rolled-back ]
back_to_full "the copy put back by hand"

# The side the files left, not yet committed there: a person's edit of another file.
kill_at to-commit
printf 'more\n' >>"$R/src/a.txt"
refused "an edit where the files left (before its commit)" "src/a.txt"
check "an edit where the files left: the edit kept" grep -q more "$R/src/a.txt"
g -C "$R" checkout -q -- src/a.txt
recover_then_back "that edit undone by hand"

# The side the files left, committed there: a person's new file.
kill_at profile
printf 'new\n' >"$R/new.txt"
refused "a new file where the files left (committed)" "new.txt"
check "a new file where the files left: it stays" present "$R/new.txt"
rm -f "$R/new.txt"
recover_then_back "that file removed by hand"

# The repository rewritten under the marker: said as such, not as "commits since".
kill_at to-commit
base="$(git -C "$R" rev-parse HEAD)"
g -C "$R" commit -q --amend --allow-empty -m "rewritten"
refused "the repository not at the marker's commit" "is not at the commit"
check "the repository not at the marker's commit: not called commits since" bash -c "! grep -q 'has commits since' '$T/err'"
g -C "$R" reset -q --hard "$base"
recover_then_back "the repository put back by hand"

# A marker that cannot be read: refused with what to do.
printf '{"to":' >"$MARKER"
run "$SET" -C "$R" --expect "$(fp)" --move silent >"$T/out" 2>"$T/err"
check "a broken marker: exit 1" [ $? -eq 1 ]
check "a broken marker: the reason says it cannot be read" grep -q "cannot be read" "$T/err"
check "a broken marker: and to delete it by hand" grep -q "then delete the marker" "$T/err"
check "a broken marker: --read prints interrupted" [ "$(run "$SET" -C "$R" --field mode --field workflow.folder --read | json_get interrupted)" = true ]
printf '{"to":"silent","rels":[]}\n' >"$MARKER"
run "$SET" -C "$R" --expect "$(fp)" --move silent >/dev/null 2>"$T/err"
check "a marker of another shape: refused with what to do" grep -q "cannot be read (it is not the marker of a move).*then delete the marker" "$T/err"
rm -f "$MARKER"
check "no move left under way" absent "$MARKER"

# --- a file the receiving side's .gitignore ignores -------------------------------------------------------------
mkdir -p "$T/own"
g -C "$T/own" init -q
printf '*.png\n' >"$T/own/.gitignore"
g -C "$T/own" add -A
g -C "$T/own" commit -q -m init
out="$(run "$SET" -C "$R" --expect "$(fp)" --move silent --folder "$T/own" 2>"$T/err")"
check "an ignored file: the move exits 0" [ $? -eq 0 ]
check "an ignored file: named in the report" [ "$(json_get moved <<<"$out" | json_get ignored)" = '["docs/adr/d.png"]' ]
check "an ignored file: committed in the Workflow folder all the same" [ -n "$(git -C "$T/own" ls-files docs/adr/d.png)" ]
check "an ignored file: gone from the repository" absent "$R/docs/adr/d.png"
check "an ignored file: both sides clean" clean "$R" "$T/own"

home_after="$(real_home_snapshot "$REAL_HOME")"
check "the real ~/.claude and ~/.claude/worfy-harness are unchanged" [ "$home_before" = "$home_after" ]
[ "$home_before" = "$home_after" ] || real_home_diff "$home_before" "$home_after"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
