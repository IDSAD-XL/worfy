#!/usr/bin/env bash
# Tests of harness/bin/land on what a PR may change and when it may merge at all: a draft
# waits; a PR that changes a verification path (lib/verification-paths.cjs and the profile's verification.paths) merges
# only when the trail of its ticket — the ticket of its branch by tickets.branch, read at the tip of the base branch,
# never at the PR's fork point — names that path; a PR with no ticket waits for the owner; a PR that adds a verification
# path to a trail is named as such; the line of a merged PR names its verification paths; the CI check is the profile's
# workflow.ci_check, and a state file naming another is refused; `land --check <N>` answers for one PR with no state file.
# The world is land-world.sh's: a bare origin, a clone as the checkout, node stubs for gh and bin/profile. No network, no
# real gh, no model. Split from land.test.sh by theme, so each file stays inside the per-file time limit of
# test/harness-scripts-suite.ts.
# Run: bash harness/bin/tests/land-verification.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/land-world.sh"
# The gate registry and state folder of the marker of a red main branch (main-red-<key>.json), as in land.test.sh: one
# entry, key land-test, matches every world under $T.
printf '{"repos":[{"key":"land-test","match":%s}]}\n' "$(node -p 'JSON.stringify(require("fs").realpathSync.native(process.argv[1]))' "$TN")" >"$T/gate-config.json"
mkdir -p "$T/gate-state"
export CLAUDE_GATE_CONFIG="$TN/gate-config.json" CLAUDE_GATE_STATE="$TN/gate-state"
MR="$T/gate-state/main-red-land-test.json"

# pr_file <N> <path> <text>: the head of PR N gets <path> with <text> (a new commit on it).
pr_file() {
    git -C "$W/seed" fetch -q origin "refs/pull/$1/head" && git -C "$W/seed" checkout -q --detach FETCH_HEAD
    mkdir -p "$(dirname "$W/seed/$2")" && printf '%s\n' "$3" >"$W/seed/$2"
    git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m "pr $1: $2" && git -C "$W/seed" push -q -f origin "HEAD:refs/pull/$1/head"
    git -C "$W/seed" checkout -q main
}
# main_file <path> <text>: the main branch of the origin gets <path> with <text>, after every PR forked off it.
main_file() {
    git -C "$W/seed" checkout -q main && git -C "$W/seed" pull -q --ff-only origin main
    mkdir -p "$(dirname "$W/seed/$1")" && printf '%s\n' "$2" >"$W/seed/$1"
    git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m "main: $1" && git -C "$W/seed" push -q origin main
}
# ticket_text <path>…: a ticket file whose trail ("## Where in the code") names each path in backticks.
ticket_text() {
    printf '# 01: a ticket\n\nStatus: claimed\n\n## Where in the code\n\n'
    for p in "$@"; do printf -- '- `%s` — line `:12`, the function `ready()`\n' "$p"; done
    printf '\n## Tests\n\n- `AGENTS.md`\n'
}
# pr_link <N> <path> <target>: the head of PR N gets <path> as a symbolic link to <target>, written as git stores one
# (mode 120000, the target as its blob), so it is a link on every system, Git Bash on Windows included.
pr_link() {
    git -C "$W/seed" fetch -q origin "refs/pull/$1/head" && git -C "$W/seed" checkout -q --detach FETCH_HEAD
    local blob; blob="$(printf '%s' "$3" | git -C "$W/seed" hash-object -w --stdin)"
    git -C "$W/seed" update-index --add --cacheinfo "120000,$blob,$2" && git -C "$W/seed" commit -q -m "pr $1: link $2" \
        && git -C "$W/seed" push -q -f origin "HEAD:refs/pull/$1/head"
    git -C "$W/seed" reset -q --hard && git -C "$W/seed" checkout -q -f main
}
# pr_gitlink <N> <path>: the head of PR N gets <path> as a submodule entry (mode 160000), whose files git puts under <path>/.
pr_gitlink() {
    git -C "$W/seed" fetch -q origin "refs/pull/$1/head" && git -C "$W/seed" checkout -q --detach FETCH_HEAD
    git -C "$W/seed" update-index --add --cacheinfo "160000,$(git -C "$W/seed" rev-parse HEAD),$2" && git -C "$W/seed" commit -q -m "pr $1: submodule $2" \
        && git -C "$W/seed" push -q -f origin "HEAD:refs/pull/$1/head"
    git -C "$W/seed" reset -q --hard && git -C "$W/seed" checkout -q -f main
}
TICKET=.scratch/e/issues/01-a-ticket.md
VP=CLAUDE.md

# --- a draft waits, even with a green CI and review (red on the old code: it merged a draft) ---------------------------
new_world draft 1
state 1
echo '{"isDraft":true}' >"$GHD/pr-1.json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qx '#1 waits: draft' "$W/out" && tail -n 1 "$W/out" | grep -qx 'LAND=unverified' \
    && ok "draft: green CI and review, but a draft -> '#1 waits: draft', not merged" || bad "draft: exit $rc: $(cat "$W/out")"

# --- a verification path the trail at the tip of main does not name waits ------------------------------------------
new_world outside 1
main_file "$TICKET" "$(ticket_text f1.txt)"
pr_file 1 "$VP" "the rules"
state 1
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qx "#1 waits: verification paths outside the trail of e 01: $VP" "$W/out" \
    && ok "outside the trail: the PR changes $VP, the trail names f1.txt -> waits, the path in the reason" || bad "outside: exit $rc: $(cat "$W/out")"
# the PR writes the path into its own trail: no permission, the trail is read at the tip of main
pr_file 1 "$TICKET" "$(ticket_text f1.txt "$VP")"
rm -f "$GHD/log"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qx "#1 waits: verification paths outside the trail of e 01: $VP" "$W/out" \
    && ok "own trail: the PR adds $VP to its own trail -> still waits (the trail of main counts, not the PR's)" || bad "own trail: exit $rc: $(cat "$W/out")"

# --- the trail extended on main after the branch was cut: the fork point holds the old trail, the PR merges -----------
new_world extended 1
main_file "$TICKET" "$(ticket_text f1.txt)"
git -C "$W/seed" fetch -q origin refs/pull/1/head && git -C "$W/seed" checkout -q --detach FETCH_HEAD && git -C "$W/seed" rebase -q main \
    && git -C "$W/seed" push -q -f origin HEAD:refs/pull/1/head && git -C "$W/seed" checkout -q main
pr_file 1 "$VP" "the rules"
main_file "$TICKET" "$(ticket_text f1.txt "$VP")"
state 1
fork="$(git -C "$W/origin.git" merge-base refs/pull/1/head refs/heads/main)"
old_trail="$(git -C "$W/origin.git" show "$fork:$TICKET")"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
m1="$(q "$S" 's.prs[0].result.sha')"
[[ "$old_trail" != *"$VP"* ]] && [ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && grep -qx "#1 merged $m1 — verification paths: $VP (trail of e 01)" "$W/out" \
    && ok "extended trail: the fork point's trail lacks $VP, main's names it -> merged, the line names the path and the trail" || bad "extended: old trail has it=$([[ "$old_trail" == *"$VP"* ]] && echo yes) exit $rc: $(cat "$W/out")"

# --- a PR that adds a verification path to a trail is named as a change of the verification paths ---------------------
new_world extends 1 2
main_file "$TICKET" "$(ticket_text f1.txt)"
pr_file 2 .scratch/e/issues/03-other.md "$(ticket_text f3.txt tools/check-x.mjs)"
state 2
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
m2="$(q "$S" 's.prs[0].result.sha')"
[ "$rc" = 0 ] && [ "$(merged_of 2)" = 1 ] && grep -qx "#2 merged $m2 — verification paths: added to the trail of .scratch/e/issues/03-other.md: tools/check-x.mjs" "$W/out" \
    && ok "trail extension: a PR adds tools/check-x.mjs (a path of the profile) to a trail -> merged, the line names it" || bad "extends: exit $rc: $(cat "$W/out")"
grep -q -- '--json' "$GHD/profile.log" && ok "trail extension: the verification paths come from the profile (bin/profile --json)" || bad "extends: profile calls $(cat "$GHD/profile.log")"

# --- a PR without a ticket that changes a verification path waits for the owner -------------------------------------
new_world noticket 1
main_file "$TICKET" "$(ticket_text f1.txt "$VP")"
pr_file 1 "$VP" "the rules"
echo '{"headRefName":"fix-ci-by-hand"}' >"$GHD/pr-1.json"
state 1
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qx "#1 waits: verification paths, and the PR has no ticket (the branch fix-ci-by-hand is not <epic>/<NN>): $VP — the owner decides" "$W/out" \
    && ok "no ticket: the branch is not <epic>/<NN>, the PR changes $VP -> waits for the owner" || bad "no ticket: exit $rc: $(cat "$W/out")"
# a PR without a ticket that changes no verification path merges as before
new_world noticket-plain 1
echo '{"headRefName":"fix-typo"}' >"$GHD/pr-1.json"
state 1
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && grep -q '^#1 merged [0-9a-f]\{40\}$' "$W/out" \
    && ok "no ticket, no verification path: merged, the line names nothing" || bad "no ticket plain: exit $rc: $(cat "$W/out")"

# --- the CI check is the profile's workflow.ci_check: a state file naming another is refused ---------------------------
new_world cicheck 1
state 1
echo '{"workflow":{"ci":"pr","ci_check":"ci-summary"}}' >"$GHD/profile.json"
"$LAND" "$S" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 1 ] && [ "$(merges)" = 0 ] && grep -q '"ci_check" is "ci-ok", but the profile'"'"'s workflow.ci_check is "ci-summary"' "$W/err" \
    && ok "ci_check: the state file names ci-ok, the profile ci-summary -> refused, exit 1, nothing merged" || bad "ci_check: exit $rc: $(cat "$W/out" "$W/err")"

# --- land --check <N>: the condition of one PR, no state file -----------------------------------------------------
new_world check 1
run_id=4242
echo "[{\"id\":1,\"name\":\"ci-ok\",\"status\":\"completed\",\"conclusion\":\"success\",\"started_at\":\"2026-10-28T10:00:00Z\",\"details_url\":\"https://github.com/o/r/actions/runs/$run_id/job/1\"}]" >"$GHD/checks-$(head_of 1)"
echo "[{\"databaseId\":$run_id,\"status\":\"completed\",\"conclusion\":\"success\",\"workflowName\":\"CI\"}]" >"$GHD/runs-$(head_of 1)"
start=$(node -p 'Date.now()')
(cd "$W/repo" && "$LAND" --check 1 >"$W/out" 2>"$W/err"); rc=$?
took=$(( $(node -p 'Date.now()') - start ))
[ "$rc" = 0 ] && [ "$(cat "$W/out")" = "#1 ready" ] && [ "$(merges)" = 0 ] && [ ! -e "$W/state.json" ] \
    && ok "check: a green PR -> exit 0, '#1 ready', nothing merged, no state file (${took} ms)" || bad "check ready: exit $rc: $(cat "$W/out" "$W/err")"
grep -q -- "--workflow CI --branch main --event push" "$GHD/log" \
    && ok "check: the main branch is read in the workflow of the ci-ok run (CI)" || bad "check: main runs read $(grep 'run list' "$GHD/log")"
echo "$took" >"$T/check-ms"
echo '{"isDraft":true}' >"$GHD/pr-1.json"
"$LAND" --check 1 -C "$(tn "$W/repo")" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 1 ] && [ "$(cat "$W/out")" = "#1 waits: draft" ] && ok "check: a draft -> exit 1, the reason on one line" || bad "check draft: exit $rc: $(cat "$W/out" "$W/err")"
rm -f "$GHD/pr-1.json" && echo '{"review":"pending"}' >"$GHD/status-$(head_of 1).json"
"$LAND" --check 1 -C "$(tn "$W/repo")" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 1 ] && [ "$(wc -l <"$W/out" | tr -d ' ')" = 1 ] && grep -qx "#1 waits: review is pending on $(head_of 1 | cut -c1-8)" "$W/out" \
    && ok "check: review pending -> exit 1, one line" || bad "check review: exit $rc: $(cat "$W/out" "$W/err")"
rm -f "$GHD/status-$(head_of 1).json" && touch "$GHD/gh-down"
"$LAND" --check 1 -C "$(tn "$W/repo")" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 2 ] && [ "$(wc -l <"$W/out" | tr -d ' ')" = 1 ] && grep -q '^#1 unverified: gh pr view 1: gh exit 1' "$W/out" \
    && ok "check: gh does not answer -> exit 2, cannot say" || bad "check gh down: exit $rc: $(cat "$W/out" "$W/err")"
rm -f "$GHD/gh-down" && echo 3 >"$GHD/profile-rc"
"$LAND" --check 1 -C "$(tn "$W/repo")" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 2 ] && grep -q '^#1 unverified: no profile' "$W/out" && ok "check: no profile -> exit 2" || bad "check no profile: exit $rc: $(cat "$W/out" "$W/err")"
rm -f "$GHD/profile-rc"
# the Pipeline's Checks: check/windows missing on the head waits
echo '{"_resolved":{"checkout":"'"$(tn "$W/repo")"'","mode":"full","pipeline":[{"kind":"ci"},{"kind":"check","name":"windows"}]}}' >"$GHD/profile.json"
"$LAND" --check 1 -C "$(tn "$W/repo")" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 1 ] && grep -qx "#1 waits: check/windows is missing on $(head_of 1 | cut -c1-8)" "$W/out" \
    && ok "check: the Pipeline's Check windows has no mark -> exit 1" || bad "check pipeline: exit $rc: $(cat "$W/out" "$W/err")"
rm -f "$GHD/profile.json"
# a verification path outside the trail -> exit 1 with the paths
main_file "$TICKET" "$(ticket_text f1.txt)"
pr_file 1 "$VP" "the rules"
echo "[{\"id\":1,\"name\":\"ci-ok\",\"status\":\"completed\",\"conclusion\":\"success\",\"started_at\":\"2026-10-28T10:00:00Z\",\"details_url\":\"https://github.com/o/r/actions/runs/$run_id/job/1\"}]" >"$GHD/checks-$(head_of 1)"
echo "[{\"databaseId\":$run_id,\"status\":\"completed\",\"conclusion\":\"success\",\"workflowName\":\"CI\"}]" >"$GHD/runs-$(head_of 1)"
"$LAND" --check 1 -C "$(tn "$W/repo")" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 1 ] && grep -qx "#1 waits: verification paths outside the trail of e 01: $VP" "$W/out" \
    && ok "check: a verification path outside the trail -> exit 1, the path named" || bad "check outside: exit $rc: $(cat "$W/out" "$W/err")"

# --- review round 1 -----------------------------------------------------------------------------------------------
# a symbolic link .claude -> docs/x (with docs/x/settings.json) changes what .claude/** holds: it is a verification path
new_world link 1
main_file "$TICKET" "$(ticket_text f1.txt)"
pr_file 1 docs/x/settings.json '{"hooks":{}}'
pr_link 1 .claude docs/x
state 1
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qx "#1 waits: verification paths outside the trail of e 01: .claude" "$W/out" \
    && ok "symlink: the PR adds a link .claude -> docs/x -> waits, .claude named" || bad "symlink .claude: exit $rc: $(cat "$W/out")"
# any symbolic link counts: no glob can tell what it reaches
new_world link-any 1
main_file "$TICKET" "$(ticket_text f1.txt)"
pr_link 1 docs/link ../.github/workflows
state 1
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qx "#1 waits: verification paths outside the trail of e 01: docs/link" "$W/out" \
    && ok "symlink: any link the PR adds waits unless the trail names it" || bad "symlink any: exit $rc: $(cat "$W/out")"
# the trail names the link: it merges
main_file "$TICKET" "$(ticket_text f1.txt docs/link)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && grep -q "^#1 merged [0-9a-f]\{40\} — verification paths: docs/link (trail of e 01)$" "$W/out" \
    && ok "symlink: a link the trail names merges, its line names it" || bad "symlink named: exit $rc: $(cat "$W/out")"

# a change at a parent folder of a verification glob: a submodule at tools/ puts its tools/check-* there
new_world parent 1
main_file "$TICKET" "$(ticket_text f1.txt)"
pr_gitlink 1 tools
state 1
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qx "#1 waits: verification paths outside the trail of e 01: tools" "$W/out" \
    && ok "parent folder: a submodule at tools (above tools/check-*) -> waits, tools named" || bad "parent folder: exit $rc: $(cat "$W/out")"
# a regular file there hides no folder: it merges, and its line names no verification path
new_world parent-file 1
main_file "$TICKET" "$(ticket_text f1.txt)"
pr_file 1 tools "a plain file"
state 1
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && grep -q "^#1 merged [0-9a-f]\{40\}$" "$W/out" \
    && ok "parent folder: a regular file tools is no folder above tools/check-* -> merged" || bad "parent file: exit $rc: $(cat "$W/out")"

# the ticket file missing at the tip of main, or there twice: the PR waits
new_world noticketfile 1
pr_file 1 "$VP" "the rules"
state 1
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qxF "#1 waits: verification paths outside the trail of e 01 (.scratch/e/issues/01-*.md is not in refs/remotes/origin/main): $VP" "$W/out" \
    && ok "ticket file: not at the tip of main -> waits, the reason says so" || bad "no ticket file: exit $rc: $(cat "$W/out")"
main_file "$TICKET" "$(ticket_text f1.txt "$VP")"
main_file .scratch/e/issues/01-a-copy.md "$(ticket_text f1.txt "$VP")"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qF "#1 waits: verification paths outside the trail of e 01 (2 files in refs/remotes/origin/main: " "$W/out" \
    && ok "ticket file: two files of 01 at the tip of main -> waits" || bad "two ticket files: exit $rc: $(cat "$W/out")"

# a read-only item of the trail allows nothing
new_world readonly 1
main_file "$TICKET" "$(printf '# 01: a ticket\n\nStatus: claimed\n\n## Where in the code\n\n- `f1.txt`\n- Read only: `%s`\n' "$VP")"
pr_file 1 "$VP" "the rules"
state 1
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qx "#1 waits: verification paths outside the trail of e 01: $VP" "$W/out" \
    && ok "read only: the trail lists $VP as read only -> waits" || bad "read only: exit $rc: $(cat "$W/out")"
# the shape most tickets have: a plain read-only paragraph (the Russian words) with a continuation line of no indent
main_file "$TICKET" "$(printf '# 01: a ticket\n\nStatus: claimed\n\n## Where in the code\n\n- `f1.txt`\n\nТолько читать: `docs/a.md`,\n`%s`, `AGENTS.md`.\n' "$VP")"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qx "#1 waits: verification paths outside the trail of e 01: $VP" "$W/out" \
    && ok "read only: a plain paragraph 'Только читать:' allows nothing -> waits" || bad "read only paragraph: exit $rc: $(cat "$W/out")"

# a PR that turns into a draft between the first reading and the one under the main-branch lock
new_world draft-late 1
state 1
touch "$GHD/draft-after-1"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qx '#1 waits: draft' "$W/out" \
    && ok "draft: a draft by the reading under the lock -> waits, not merged" || bad "draft late: exit $rc: $(cat "$W/out")"

# a draft whose CI still runs: the reason is the draft, not the CI it would wait for anyway
new_world draft-ci 1
state 1
echo '{"isDraft":true}' >"$GHD/pr-1.json"
echo '[{"id":2,"name":"ci-ok","status":"in_progress","conclusion":null,"started_at":"2026-10-28T10:00:00Z"}]' >"$GHD/checks-$(head_of 1)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qx '#1 waits: draft' "$W/out" \
    && ok "draft: a draft with ci-ok in progress -> '#1 waits: draft'" || bad "draft ci: exit $rc: $(cat "$W/out")"

# no workflow.ci_check in the profile: the state file's name stands, and the output says so
new_world nocicheck 1
state 1
echo '{"workflow":{"ci":"pr","ci_check":null}}' >"$GHD/profile.json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && grep -qx "the CI check ci-ok is the state file's: the profile names no workflow.ci_check" "$W/out" \
    && ok "ci_check: none in the profile -> the state file's ci-ok, one output line says so" || bad "no ci_check: exit $rc: $(cat "$W/out")"

# the profile unreadable (exit 1): a PR without a ticket waits on it, never merges
new_world profile-broken 1
state 1
edit 'delete s.prs[0].epic;delete s.prs[0].ticket'
echo 1 >"$GHD/profile-rc"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: the profile could not be read: bin/profile exit 1' "$W/out" \
    && ok "profile: bin/profile exit 1 -> the PR waits, not read as no profile" || bad "profile broken: exit $rc: $(cat "$W/out")"

# land --check: the profile unreadable or no JSON -> exit 2; the Code story of the branch's ticket; mergeable; a closed PR
new_world check2 1
echo '[{"id":1,"name":"ci-ok","status":"completed","conclusion":"success","started_at":"2026-10-28T10:00:00Z","details_url":"https://github.com/o/r/actions/runs/4242/job/1"}]' >"$GHD/checks-$(head_of 1)"
echo '[{"databaseId":4242,"status":"completed","conclusion":"success","workflowName":"CI"}]' >"$GHD/runs-$(head_of 1)"
echo 1 >"$GHD/profile-rc"
"$LAND" --check 1 -C "$(tn "$W/repo")" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 2 ] && grep -q '^#1 unverified: the profile could not be read: bin/profile exit 1' "$W/out" && ok "check: bin/profile exit 1 -> exit 2" || bad "check profile 1: exit $rc: $(cat "$W/out" "$W/err")"
rm -f "$GHD/profile-rc" && touch "$GHD/profile-garbage"
"$LAND" --check 1 -C "$(tn "$W/repo")" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 2 ] && grep -q '^#1 unverified: the profile could not be read: bin/profile exit 0' "$W/out" && ok "check: bin/profile prints no JSON -> exit 2" || bad "check profile garbage: exit $rc: $(cat "$W/out" "$W/err")"
rm -f "$GHD/profile-garbage" && echo on >"$GHD/code-stories"
"$LAND" --check 1 -C "$(tn "$W/repo")" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 1 ] && grep -q '^#1 waits: no Code story of ticket e 01: ' "$W/out" \
    && ok "check: code_stories.pr on, the branch's ticket e 01 has no story -> exit 1 (the ticket reaches the story check)" || bad "check story: exit $rc: $(cat "$W/out" "$W/err")"
echo off >"$GHD/code-stories" && echo UNKNOWN >"$GHD/mergeable-1"
"$LAND" --check 1 -C "$(tn "$W/repo")" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 1 ] && grep -q '^#1 waits: mergeable UNKNOWN' "$W/out" && ok "check: mergeable UNKNOWN -> exit 1, not ready" || bad "check unknown: exit $rc: $(cat "$W/out" "$W/err")"
echo CONFLICTING >"$GHD/mergeable-1"
"$LAND" --check 1 -C "$(tn "$W/repo")" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 1 ] && grep -q '^#1 waits: conflict: rebase' "$W/out" && ok "check: a conflict -> exit 1" || bad "check conflict: exit $rc: $(cat "$W/out" "$W/err")"
rm -f "$GHD/mergeable-1" && echo '{"state":"CLOSED"}' >"$GHD/pr-1.json"
"$LAND" --check 1 -C "$(tn "$W/repo")" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 1 ] && [ "$(cat "$W/out")" = "#1 waits: the PR is CLOSED" ] && ok "check: a closed PR -> exit 1" || bad "check closed: exit $rc: $(cat "$W/out" "$W/err")"
rm -f "$GHD/pr-1.json"
# a red main branch: land --check writes no marker; a run of land on the same world does (so the check can fail)
C2="$(printf '2%.0s' $(seq 1 40))"
printf '[{"databaseId":2,"headSha":"%s","status":"completed","conclusion":"failure","attempt":1,"createdAt":"2026-11-09T10:00:00Z","updatedAt":"2026-11-09T10:30:00Z","url":"https://github.com/o/r/actions/runs/2"}]\n' "$C2" >"$GHD/main-runs"
rm -f "$MR"
"$LAND" --check 1 -C "$(tn "$W/repo")" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 1 ] && grep -q '^#1 waits: main red since 22222222' "$W/out" && [ ! -e "$MR" ] \
    && ok "check: main red -> exit 1, and no marker of the main branch written" || bad "check red main: exit $rc marker=$([ -e "$MR" ] && echo yes): $(cat "$W/out" "$W/err")"
state 1
"$LAND" "$S" >"$W/out" 2>&1
[ -e "$MR" ] && ok "check: the same red main makes a run of land write the marker" || bad "marker control: no $MR after land: $(cat "$W/out")"

# the real HOME is untouched
[ "$(real_home_snapshot "$HOME" "$T")" = "$home_before" ] && ok "the real HOME is untouched" || bad "the real HOME changed"
echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
