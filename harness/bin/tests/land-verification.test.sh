#!/usr/bin/env bash
# Tests of harness/bin/land on what a PR may change and when it may merge at all (worfy-harness-guarantees 04): a draft
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
export CLAUDE_GATE_CONFIG="$TN/no-gate-config.json" CLAUDE_GATE_STATE="$TN/gate-state"

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
! ls "$TN/gate-state" >/dev/null 2>&1 && ok "check: writes no marker of the main branch" || bad "check: wrote $(ls "$TN/gate-state")"

# the real HOME is untouched
[ "$(real_home_snapshot "$HOME" "$T")" = "$home_before" ] && ok "the real HOME is untouched" || bad "the real HOME changed"
echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
