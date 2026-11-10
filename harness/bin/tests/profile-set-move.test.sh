#!/usr/bin/env bash
# Tests of `harness/bin/profile-set --move`: the move of a project's workflow files between Full mode and
# Silent mode (lib/workflow-move.cjs). mode and workflow.folder are written only by a move, never by --field;
# a stranger fingerprint is a conflict. Full -> Silent puts the tickets, the state file, the ADRs and the
# glossary in the Workflow folder with a commit there and a commit removing them in the repository, and
# bin/profile prints the new mode and folder; Silent -> Full brings them back; a project of several
# repositories cannot move to Full mode. Uncommitted changes, an open PR of a ticket's branch, or gh unable to
# tell are refused before anything is written; a failure half-way puts both sides and the profile back.
# Run: bash harness/bin/tests/profile-set-move.test.sh; exit code 0 — everything passed.
#
# Everything runs in a temporary HOME and HARNESS_HOME; gh is always a node stand-in ($PROFILE_SET_GH) that
# prints a prepared answer, with no credential. The real ~/.claude and ~/.claude/worfy-harness are compared
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
    echo "FAIL $1"
    # What the last run said, so a red run on another system can be told without a rerun.
    [ -s "${T:-}/err" ] && echo "     stderr: $(head -c 400 "$T/err")"
    [ -n "${R:-}" ] && [ -d "$R" ] && echo "     repository status: $(git -C "$R" status --porcelain | head -5 | tr '\n' ' ')"
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
mkdir -p "$H" "$HH/gate" "$HH/projects/demo" "$HH/projects/multi" "$R" "$T/r/m1" "$T/r/m2" "$T/ghcfg"

g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=main "$@"; }

# The repository of a Full mode project: tickets, the state file, ADRs, the glossary, and code that stays.
g -C "$R" init -q
mkdir -p "$R/.scratch/epic-a/issues" "$R/docs/adr" "$R/src"
printf '# 01 — one\n\nStatus: open\n\n## What\n\nBranch: not-a-header-line\n' >"$R/.scratch/epic-a/issues/01-one.md"
printf '# 02 — two\n\nStatus: claimed 2026-11-10T00:00Z\nBranch: fix/two\n\n## What\n' >"$R/.scratch/epic-a/issues/02-two.md"
printf '# spec\n' >"$R/.scratch/epic-a/spec.md"
printf '# state\n' >"$R/HANDOFF.md"
printf '# 0001 — a decision\n' >"$R/docs/adr/0001-a.md"
printf '# glossary\n' >"$R/CONTEXT.md"
printf 'code\n' >"$R/src/a.txt"
g -C "$R" add -A
g -C "$R" commit -q -m init
g -C "$R" config user.name t
g -C "$R" config user.email t@t

# A project over two repositories, always Silent mode.
for m in m1 m2; do g -C "$T/r/$m" init -q && g -C "$T/r/$m" commit -q --allow-empty -m init; done

cat >"$HH/gate/config.json" <<EOF
{"repos":[{"key":"demo","match":"$R","profile":"demo"},{"key":"m1","match":"$T/r/m1","profile":"multi"},{"key":"m2","match":"$T/r/m2","profile":"multi"}]}
EOF
cat >"$HH/projects/demo/profile.json" <<'EOF'
{
  "schema": 2,
  "name": "demo",
  "mode": "full",
  "commands": { "test": "make test" },
  "tickets": { "root": ".scratch/", "path": ".scratch/<epic>/issues/NN-*.md", "branch": "<epic>/<NN>" },
  "workflow": { "folder": null },
  "docs": { "adr_dir": "docs/adr", "handoff": { "path": "HANDOFF.md" }, "context": { "path": "CONTEXT.md" } },
  "numbering": { "adr": { "dir": "docs/adr" } }
}
EOF
printf '{"schema":2,"name":"multi","mode":"silent","workflow":{"folder":null}}\n' >"$HH/projects/multi/profile.json"
printf '/*\n!/.gitignore\n!/projects/\n/projects/*/workflow/\n!/gate/\n/gate/*\n!/gate/config.json\n' >"$HH/.gitignore"
g -C "$HH" init -q
g -C "$HH" add -A
g -C "$HH" commit -q -m init
PJ="$HH/projects/demo/profile.json"
WF="$HH/projects/demo/workflow"

# gh: a node stand-in that prints $GH_ANSWER and exits with $GH_CODE (0 by default); it notes each run.
GH="$T/gh-stand-in.mjs"
cat >"$GH" <<'EOF'
import { appendFileSync } from "node:fs"
if (process.env.GH_RUNS) appendFileSync(process.env.GH_RUNS, process.argv.slice(2).join(" ") + "\n")
process.stdout.write(process.env.GH_ANSWER ?? "[]")
if (process.env.GH_CODE && process.env.GH_CODE !== "0") process.stderr.write("HTTP 401: Bad credentials\n")
process.exit(Number(process.env.GH_CODE || 0))
EOF
run() {
    env -u CLAUDE_GATE_CONFIG -u CLAUDE_PROFILES_DIR -u EVAL_HARNESS_HOME -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN \
        HOME="$H" USERPROFILE="$H" HARNESS_HOME="$HH" PROFILE_SET_GH="$GH" GH_RUNS="$T/gh-runs" GH_TOKEN=invalid GH_CONFIG_DIR="$T/ghcfg" "$@"
}
json_get() { node -e 'const v=JSON.parse(require("fs").readFileSync(0,"utf8"))[process.argv[1]]; process.stdout.write(v===null?"null":typeof v==="string"?v:JSON.stringify(v))' "$1"; }
fp() { run "$SET" -C "$R" --field mode --field workflow.folder --read | json_get fingerprint; }
pj_field() { node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const v=process.argv[2].split(".").reduce((o,k)=>o==null?undefined:o[k],p); process.stdout.write(v===undefined?"absent":JSON.stringify(v))' "$PJ" "$1"; }
hh_commits() { git -C "$HH" rev-list --count HEAD; }
# same_dir <a> <b>: one folder, however each is spelt (bin/profile prints D:\a\… on Windows, pwd -W D:/a/…).
same_dir() { node -e 'const fs=require("fs"),[a,b]=process.argv.slice(1).map((p)=>fs.realpathSync.native(p).replace(/\\/g,"/")); process.exit((process.platform==="win32"?a.toLowerCase()===b.toLowerCase():a===b)?0:1)' "$1" "$2"; }
head_of() { git -C "$1" rev-parse HEAD; }
clean() { for d; do [ -z "$(git -C "$d" status --porcelain)" ] || return 1; done; }
present() { for f; do [ -e "$f" ] || return 1; done; }
absent() { for f; do [ ! -e "$f" ] || return 1; done; }
# unchanged <label>: the repository, the profile and the Harness history as before the refused or failed move.
unchanged() {
    check "$1: profile.json unchanged" cmp -s "$PJ" "$T/pj-before"
    check "$1: no commit in the repository" [ "$(head_of "$R")" = "$repo_head" ]
    check "$1: the workflow files still in the repository" present "$R/.scratch/epic-a/issues/02-two.md" "$R/HANDOFF.md" "$R/docs/adr/0001-a.md"
    check "$1: no commit in the Harness home" [ "$(hh_commits)" = "$hh_before" ]
    check "$1: no Workflow folder made" [ ! -e "$WF" ]
    check "$1: no lock left" [ ! -e "$HH/projects/demo/.profile-set.lock" ]
}
snapshot() {
    cp "$PJ" "$T/pj-before"
    repo_head="$(head_of "$R")"
    hh_before="$(hh_commits)"
}

# --- usage, and mode and workflow.folder never written by --field ------------------------------------------
FP="$(fp)"
check "the fingerprint of mode and workflow.folder is read" [ -n "$FP" ]
run "$SET" -C "$R" --field mode --expect "$FP" --set '{"mode":"silent"}' >/dev/null 2>"$T/err"
check "--field mode --set: usage error, exit 2" [ $? -eq 2 ]
run "$SET" -C "$R" --field workflow.folder --expect "$FP" --set '{"workflow.folder":"/x"}' >/dev/null 2>&1
check "--field workflow.folder --set: exit 2" [ $? -eq 2 ]
run "$SET" -C "$R" --expect "$FP" --move bogus >/dev/null 2>&1
check "--move bogus: exit 2" [ $? -eq 2 ]
run "$SET" -C "$R" --move silent >/dev/null 2>&1
check "--move without --expect: exit 2" [ $? -eq 2 ]
run "$SET" -C "$R" --expect "$FP" --move full --folder "$T/wf" >/dev/null 2>&1
check "--move full --folder: exit 2" [ $? -eq 2 ]
run "$SET" -C "$R" --expect "$FP" --move silent --folder relative/wf >/dev/null 2>&1
check "--move silent with a relative --folder: exit 2" [ $? -eq 2 ]
run "$SET" -C "$R" --expect "$FP" --folder "$T/wf" --read >/dev/null 2>&1
check "--folder without --move: exit 2" [ $? -eq 2 ]

# --- refusals before any write -------------------------------------------------------------------------------
snapshot
out="$(run "$SET" -C "$R" --expect "sha256:$(printf '0%.0s' {1..64})" --move silent 2>"$T/err")"
check "a stranger fingerprint: exit 5" [ $? -eq 5 ]
check "a stranger fingerprint: conflict on stdout" [ "$(json_get conflict <<<"$out")" = true ]
unchanged "stranger fingerprint"

run "$SET" -C "$R" --expect "$FP" --move full >"$T/out" 2>"$T/err"
check "already in Full mode: exit 1" [ $? -eq 1 ]
check "already in Full mode: the reason" grep -q "already in Full mode" "$T/err"
unchanged "already in Full mode"

printf 'edit\n' >>"$R/src/a.txt"
run "$SET" -C "$R" --expect "$FP" --move silent >"$T/out" 2>"$T/err"
check "uncommitted change in the repository: exit 1" [ $? -eq 1 ]
check "uncommitted change: the reason on stderr" grep -q "the repository has uncommitted changes" "$T/err"
check "uncommitted change: the reason on stdout as JSON" grep -q '"ok":false' "$T/out"
g -C "$R" checkout -q -- src/a.txt
unchanged "uncommitted change"

printf 'new\n' >"$R/untracked.txt"
run "$SET" -C "$R" --expect "$FP" --move silent >/dev/null 2>"$T/err"
check "an untracked file in the repository: exit 1" [ $? -eq 1 ]
rm -f "$R/untracked.txt"
unchanged "untracked file"

mkdir -p "$T/wf-dirty"
g -C "$T/wf-dirty" init -q
printf 'x\n' >"$T/wf-dirty/note.md"
run "$SET" -C "$R" --expect "$FP" --move silent --folder "$T/wf-dirty" >/dev/null 2>"$T/err"
check "uncommitted change in the Workflow folder: exit 1" [ $? -eq 1 ]
check "uncommitted change in the Workflow folder: the reason" grep -q "the Workflow folder has uncommitted changes" "$T/err"
unchanged "dirty Workflow folder"

run "$SET" -C "$R" --expect "$FP" --move silent --folder "$R/inner" >/dev/null 2>"$T/err"
check "a Workflow folder inside the repository: exit 1" [ $? -eq 1 ]
check "a Workflow folder inside the repository: the reason" grep -q "outside the project's repository" "$T/err"
check "a Workflow folder inside the repository: not made" [ ! -e "$R/inner" ]
unchanged "Workflow folder inside the repository"

# A remote: gh is asked; without one it is not.
check "no remote: gh was not started" [ ! -e "$T/gh-runs" ]
g -C "$R" remote add origin https://example.invalid/demo.git
GH_ANSWER='[{"number":7,"headRefName":"epic-a/01"},{"number":9,"headRefName":"other/branch"}]' run "$SET" -C "$R" --expect "$FP" --move silent >/dev/null 2>"$T/err"
check "an open PR of a ticket branch (template): exit 1" [ $? -eq 1 ]
check "an open PR: the reason names the PR" grep -q "#7 (epic-a/01)" "$T/err"
check "an open PR: a PR of no ticket is not named" bash -c "! grep -q '#9' '$T/err'"
check "gh was asked for the open PRs" grep -q "pr list --state open" "$T/gh-runs"
unchanged "open PR (template)"
GH_ANSWER='[{"number":8,"headRefName":"fix/two"}]' run "$SET" -C "$R" --expect "$FP" --move silent >/dev/null 2>"$T/err"
check "an open PR of a ticket's Branch: line: exit 1" [ $? -eq 1 ]
check "an open PR of a Branch: line: named" grep -q "#8 (fix/two)" "$T/err"
GH_CODE=1 run "$SET" -C "$R" --expect "$FP" --move silent >/dev/null 2>"$T/err"
check "gh unable to tell: exit 1" [ $? -eq 1 ]
check "gh unable to tell: the reason" grep -q "cannot be told" "$T/err"
unchanged "gh failed"

# --- a failure half-way puts everything back -------------------------------------------------------------------
for at in copy to-commit from-commit profile; do
    PROFILE_SET_MOVE_FAIL_AT="$at" run "$SET" -C "$R" --expect "$FP" --move silent >"$T/out" 2>"$T/err"
    check "failure at $at: exit 1" [ $? -eq 1 ]
    check "failure at $at: rolled back, said" grep -q "rolled back" "$T/err"
    check "failure at $at: the repository is clean" clean "$R"
    unchanged "failure at $at"
done

# --- Full -> Silent ------------------------------------------------------------------------------------------------
out="$(run "$SET" -C "$R" --expect "$FP" --move silent 2>"$T/err")"
rc=$?
check "Full -> Silent: exit 0" [ "$rc" -eq 0 ]
[ "$rc" -eq 0 ] || echo "     stderr: $(head -c 600 "$T/err")"
check "Full -> Silent: bin/profile prints mode silent" [ "$(run "$PROFILE" -C "$R" --field mode)" = silent ]
check "Full -> Silent: the Workflow folder is the default one" same_dir "$(run "$PROFILE" -C "$R" --field _resolved.workflow_folder)" "$WF"
check "Full -> Silent: workflow.folder written" [ "$(pj_field workflow.folder)" != null ]
check "Full -> Silent: the tickets in the Workflow folder" present "$WF/.scratch/epic-a/issues/02-two.md" "$WF/.scratch/epic-a/spec.md"
check "Full -> Silent: the state file, ADRs and glossary there" present "$WF/HANDOFF.md" "$WF/docs/adr/0001-a.md" "$WF/CONTEXT.md"
check "Full -> Silent: none of them left in the repository" absent "$R/.scratch" "$R/HANDOFF.md" "$R/docs/adr" "$R/CONTEXT.md"
check "Full -> Silent: the code stays" [ -f "$R/src/a.txt" ]
check "Full -> Silent: one commit in the repository" [ "$(git -C "$R" rev-list --count HEAD)" -eq 2 ]
check "Full -> Silent: the repository commit says where the files went" bash -c "git -C '$R' log -1 --format=%s | grep -q 'into the project.s Workflow folder'"
check "Full -> Silent: one commit in the Workflow folder" [ "$(git -C "$WF" rev-list --count HEAD)" -eq 1 ]
check "Full -> Silent: the Workflow folder commit says where from" bash -c "git -C '$WF' log -1 --format=%s | grep -q 'from the repository demo'"
check "Full -> Silent: both sides clean" clean "$R" "$WF"
check "Full -> Silent: a commit in the Harness home" [ "$(hh_commits)" -eq $((hh_before + 1)) ]
check "Full -> Silent: the Harness commit message" bash -c "git -C '$HH' log -1 --format=%s | grep -q 'Move demo to Silent mode'"
check "Full -> Silent: the report names the paths" [ "$(json_get moved <<<"$out" | json_get paths)" = '[".scratch","HANDOFF.md","docs/adr","CONTEXT.md"]' ]
check "Full -> Silent: the new fingerprint is the one --read prints" [ "$(json_get fingerprint <<<"$out")" = "$(fp)" ]

# --- Silent -> Full ------------------------------------------------------------------------------------------------
FP2="$(fp)"
run "$SET" -C "$R" --expect "$FP" --move full >/dev/null 2>&1
check "Silent -> Full over the old fingerprint: exit 5" [ $? -eq 5 ]
printf 'x\n' >"$WF/HANDOFF.md"
run "$SET" -C "$R" --expect "$FP2" --move full >/dev/null 2>"$T/err"
check "Silent -> Full with an uncommitted change in the Workflow folder: exit 1" [ $? -eq 1 ]
g -C "$WF" checkout -q -- HANDOFF.md
check "Silent -> Full refused: still Silent" [ "$(run "$PROFILE" -C "$R" --field mode)" = silent ]
PROFILE_SET_MOVE_FAIL_AT=from-commit run "$SET" -C "$R" --expect "$FP2" --move full >/dev/null 2>"$T/err"
check "Silent -> Full failure at from-commit: exit 1" [ $? -eq 1 ]
check "Silent -> Full failure: the files back in the Workflow folder" present "$WF/HANDOFF.md" "$WF/.scratch/epic-a/spec.md"
check "Silent -> Full failure: none in the repository" absent "$R/HANDOFF.md" "$R/.scratch"
check "Silent -> Full failure: both sides clean" clean "$R" "$WF"
check "Silent -> Full failure: no new commit on either side" [ "$(git -C "$WF" rev-list --count HEAD):$(git -C "$R" rev-list --count HEAD)" = 1:2 ]
check "Silent -> Full failure: still Silent" [ "$(run "$PROFILE" -C "$R" --field mode)" = silent ]

out="$(run "$SET" -C "$R" --expect "$FP2" --move full 2>"$T/err")"
rc=$?
check "Silent -> Full: exit 0" [ "$rc" -eq 0 ]
[ "$rc" -eq 0 ] || echo "     stderr: $(head -c 600 "$T/err")"
check "Silent -> Full: bin/profile prints mode full" [ "$(run "$PROFILE" -C "$R" --field mode)" = full ]
check "Silent -> Full: workflow.folder null" [ "$(pj_field workflow.folder)" = null ]
check "Silent -> Full: the files back in the repository" present "$R/.scratch/epic-a/issues/01-one.md" "$R/HANDOFF.md" "$R/docs/adr/0001-a.md" "$R/CONTEXT.md"
check "Silent -> Full: none left in the Workflow folder" absent "$WF/.scratch" "$WF/HANDOFF.md"
check "Silent -> Full: a commit on each side" [ "$(git -C "$R" rev-list --count HEAD):$(git -C "$WF" rev-list --count HEAD)" = 3:2 ]
check "Silent -> Full: the repository commit says where from" bash -c "git -C '$R' log -1 --format=%s | grep -q 'from the project.s Workflow folder'"
check "Silent -> Full: the Workflow folder commit says where to" bash -c "git -C '$WF' log -1 --format=%s | grep -q 'to the repository demo'"
check "Silent -> Full: the Harness commit message" bash -c "git -C '$HH' log -1 --format=%s | grep -q 'Move demo to Full mode'"

# --- a Workflow folder of one's own --------------------------------------------------------------------------------
FP3="$(fp)"
out="$(run "$SET" -C "$R" --expect "$FP3" --move silent --folder "$T/own-wf" 2>"$T/err")"
check "Full -> Silent into a folder of one's own: exit 0" [ $? -eq 0 ]
check "a folder of one's own: made a git repository with the files" present "$T/own-wf/.git" "$T/own-wf/HANDOFF.md"
check "a folder of one's own: workflow.folder names it" same_dir "$(run "$PROFILE" -C "$R" --field _resolved.workflow_folder)" "$T/own-wf"

# --- a project of several repositories ------------------------------------------------------------------------------
FPM="$(run "$SET" -C "$T/r/m1" --field mode --field workflow.folder --read | json_get fingerprint)"
cp "$HH/projects/multi/profile.json" "$T/multi-before"
run "$SET" -C "$T/r/m1" --expect "$FPM" --move full >/dev/null 2>"$T/err"
check "several repositories -> Full: exit 1" [ $? -eq 1 ]
check "several repositories -> Full: the reason" grep -q "always in Silent mode: it cannot move to Full mode" "$T/err"
check "several repositories -> Full: profile unchanged" cmp -s "$HH/projects/multi/profile.json" "$T/multi-before"

home_after="$(real_home_snapshot "$REAL_HOME")"
check "the real ~/.claude and ~/.claude/worfy-harness are unchanged" [ "$home_before" = "$home_after" ]
[ "$home_before" = "$home_after" ] || real_home_diff "$home_before" "$home_after"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
