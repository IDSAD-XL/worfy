#!/usr/bin/env bash
# Tests of harness/bin/land: the merge condition (the CI check of the head, no CI run in progress, a main branch whose push
# runs are not red — the culprit named, documents and a main fix merged, a rerun that passed is green —, the marker of a
# red main branch for worfy (main-red-<key>.json: written, kept, removed), a main branch red on another machine (red_elsewhere:
# an open issue of its label holds the PRs its command names; documents, a main fix and the PRs it does not name merge), the review
# mark and its carry over a rebase, the Check marks a PR lists, the head the orchestrator verified), mergeable UNKNOWN asked again, BEHIND merged without a rebase and a conflict waiting, the
# main-branch lock, one documents PR per run with `ticket done` for every merged PR, the Evidence lines of
# prs[].evidence written by `ticket evidence` and the privacy check (evidence-check) before its push, a run broken
# off by a kill and resumed, --watch, and the state-file block of skill epic-wave.
# The world: a bare origin with PR refs (refs/pull/<N>/head), a clone of it as the orchestrator's checkout, and
# node stubs for gh, ticket, the wait between tries (sleep) and the documents check (land-world.sh). gh is
# always the stub: no network, no real gh, no credential. The Code story cases — the guard and the review step the
# documents PR appends — are in land-story.test.sh, split by theme so each file stays inside the per-file time limit
# of test/harness-scripts-suite.ts on a loaded machine.
# Run: bash harness/bin/tests/land.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/land-world.sh"
# The gate registry and state folder land's marker of a red main branch goes by (main-red-<key>.json): a registry whose
# one entry, key land-test, matches every world under $T; gate_state <name> gives a world a state folder of its own.
printf '{"repos":[{"key":"land-test","match":%s}]}\n' "$(node -p 'JSON.stringify(require("fs").realpathSync.native(process.argv[1]))' "$TN")" >"$T/gate-config.json"
export CLAUDE_GATE_CONFIG="$TN/gate-config.json"
gate_state() { GATE_STATE="$T/gate-$1"; mkdir -p "$GATE_STATE"; export CLAUDE_GATE_STATE="$(tn "$GATE_STATE")"; MR="$GATE_STATE/main-red-land-test.json"; }
gate_state default

# --- two green PRs: both merged, one documents PR with both tickets, no batch CI ----------------------------
new_world green 1 2
state 1 2
h1="$(head_of 1)" h2="$(head_of 2)"
"$LAND" "$S" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 0 ] && tail -n 1 "$W/out" | grep -qx 'LAND=green' && ok "green: two PRs and the documents PR merged, LAND=green, exit 0" || bad "green: exit $rc: $(cat "$W/out" "$W/err")"
grep -q "^pr merge 1 --squash --match-head-commit $h1\$" "$GHD/log" && grep -q "^pr merge 2 --squash --match-head-commit $h2\$" "$GHD/log" \
    && ok "green: gh pr merge --squash --match-head-commit <head> for each PR" || bad "green: merges $(grep '^pr merge' "$GHD/log")"
m1="$(q "$S" 's.prs[0].result.sha')"
grep -qx "#1 merged $m1" "$W/out" && grep -q '^#2 merged [0-9a-f]\{40\}$' "$W/out" && ok "green: one line per PR, '#N merged <sha>'" || bad "green: output $(cat "$W/out")"
[ "$(grep -c '^pr create' "$GHD/log")" = 1 ] && grep -qx '#900 merged [0-9a-f]\{40\}' "$W/out" && [ "$(merged_of 900)" = 1 ] \
    && ok "green: one documents PR, merged" || bad "green: documents PR: $(grep '^pr create\|^pr merge 900' "$GHD/log")"
[ "$(cat "$GHD/ticket.log")" = "$(printf 'done e 01 --pr 1 root-in-cwd=true\ndone e 02 --pr 2 root-in-cwd=true')" ] \
    && ok "green: ticket done for both PRs, in the documents worktree" || bad "green: ticket calls $(cat "$GHD/ticket.log")"
docs_head="$(git -C "$W/origin.git" rev-parse refs/pull/900/head)"
[ "$(git -C "$W/origin.git" show --name-only --format= "$docs_head" | sort | tr '\n' ' ')" = ".scratch/e/issues/01.md .scratch/e/issues/02.md " ] \
    && [ "$(git -C "$W/origin.git" rev-parse "$docs_head^")" = "$(q "$S" 's.prs[1].result.sha')" ] \
    && ok "green: one documents commit with both tickets, on main after the merges" || bad "green: documents commit $(git -C "$W/origin.git" show --stat --format=%s "$docs_head")"
[ -s "$GHD/docs-check.log" ] && [[ "$(cat "$GHD/docs-check.log")" == *state.json.docs ]] && ok "green: the documents check ran in the documents worktree" || bad "green: docs check $(cat "$GHD/docs-check.log" 2>/dev/null)"
[ "$(cat "$GHD/locks")" = "$(printf '1 held\n2 held\n900 held')" ] && [ ! -e "$LAND_TEST_LOCK" ] \
    && ok "green: every merge under the main-branch lock, released at the end" || bad "green: lock $(cat "$GHD/locks") left=$([ -e "$LAND_TEST_LOCK" ] && echo yes)"
! grep -q '^workflow run\|^run rerun' "$GHD/log" && ok "green: no CI dispatch with workflow.ci pr" || bad "green: dispatched $(grep '^workflow' "$GHD/log")"
[ -s "$W/state.log" ] && grep -q "took the main-branch lock" "$W/state.log" && ok "green: the full log is next to the state file" || bad "green: no log next to the state file"
[ ! -e "$W/state.json.docs" ] && ! git -C "$W/repo" worktree list | grep -q 'state.json.docs' && ok "green: the documents worktree is removed" || bad "green: documents worktree left"
! grep -q '^evidence ' "$GHD/ticket.log" && grep -q 'evidence-check --changed .* exit 0$' "$W/state.log" \
    && ok "green: a state file without evidence -> no ticket evidence, the privacy check passes before the push" || bad "green: evidence $(grep -i evidence "$W/state.log")"
# a second run on the same file merges nothing again
: >"$GHD/log"
"$LAND" "$S" >"$W/out2" 2>&1; rc=$?
[ "$rc" = 0 ] && ! grep -q '^pr merge\|^pr create' "$GHD/log" && [ "$(head -n 3 "$W/out2")" = "$(head -n 3 "$W/out")" ] \
    && ok "green: a second run repeats nothing and prints the same lines" || bad "green: second run exit $rc, gh $(cat "$GHD/log")"
! grep -q '^pr view' "$GHD/log" && ok "green: a second run asks GitHub nothing about a PR its state file has as merged" || bad "green: second run asked $(grep '^pr view' "$GHD/log")"

# --- a red ci-ok waits; a cancelled one too; the other PR merges -----------------------------------------------
new_world red 1 2
state 1 2
echo '[{"id":1,"name":"ci-ok","status":"completed","conclusion":"success","started_at":"2026-10-28T09:00:00Z"},{"id":2,"name":"ci-ok","status":"completed","conclusion":"failure","started_at":"2026-10-28T10:00:00Z"}]' >"$GHD/checks-$(head_of 2)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && grep -qx "#2 waits: ci-ok failure on $(head_of 2 | cut -c1-8)" "$W/out" && tail -n 1 "$W/out" | grep -qx 'LAND=red' \
    && ok "red: the latest ci-ok failure -> '#2 waits', LAND=red, exit 2" || bad "red: exit $rc: $(cat "$W/out")"
[ "$(merged_of 2)" = 0 ] && [ "$(merged_of 1)" = 1 ] && ok "red: PR 2 not merged, PR 1 merged" || bad "red: merges $(grep '^pr merge' "$GHD/log")"
new_world cancelled 1
state 1
echo '[{"id":2,"name":"ci-ok","status":"completed","conclusion":"cancelled","started_at":"2026-10-28T10:00:00Z"}]' >"$GHD/checks-$(head_of 1)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: ci-ok cancelled' "$W/out" && ok "red: a cancelled ci-ok is not merged" || bad "cancelled: exit $rc: $(cat "$W/out")"
new_world nocheck 1
state 1
echo '[{"id":3,"name":"lint-typecheck","status":"completed","conclusion":"success","started_at":"2026-10-28T10:00:00Z"}]' >"$GHD/checks-$(head_of 1)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: no ci-ok check' "$W/out" && tail -n 1 "$W/out" | grep -qx 'LAND=unverified' \
    && ok "no ci-ok on the head: waits, LAND=unverified, exit 3" || bad "nocheck: exit $rc: $(cat "$W/out")"

# --- a pending run waits, even with an older green ci-ok; ci-ok in progress waits ---------------------------
new_world pending 1
state 1
running "$(head_of 1)" queued
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: ci.yml run 7 is queued' "$W/out" \
    && ok "pending: a queued ci.yml run on the head waits although an older ci-ok is green" || bad "pending: exit $rc: $(cat "$W/out")"
rm -f "$GHD/runs-$(head_of 1)"
echo '[{"id":2,"name":"ci-ok","status":"in_progress","conclusion":null,"started_at":"2026-10-28T10:00:00Z"}]' >"$GHD/checks-$(head_of 1)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: ci-ok is in_progress' "$W/out" && ok "pending: ci-ok in progress waits" || bad "pending ci-ok: exit $rc: $(cat "$W/out")"

# --- review: missing waits; a failure is red; carried over a rebase that changed nothing --------------------
new_world review 1
state 1
echo '{}' >"$GHD/status-$(head_of 1).json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: review is missing' "$W/out" && ok "review: no review mark -> waits" || bad "review missing: exit $rc: $(cat "$W/out")"
echo '{"review":"failure"}' >"$GHD/status-$(head_of 1).json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: review is failure' "$W/out" && ok "review: a failed review is red" || bad "review failure: exit $rc: $(cat "$W/out")"
# the carry: PR 1 (which also changes line 1 of base.txt) verified at old, then rebased onto a main that changed
# line 40 of base.txt: the same diff, but its `index` line names other blobs
new_world carry 1
git -C "$W/seed" checkout -q pr1 && sed -i.bak '1s/.*/one/' "$W/seed/base.txt" && rm -f "$W/seed/base.txt.bak" && git -C "$W/seed" commit -qam line1 \
    && git -C "$W/seed" push -q -f origin pr1:refs/pull/1/head && git -C "$W/seed" checkout -q main
old="$(head_of 1)"
sed -i.bak '40s/.*/forty/' "$W/seed/base.txt" && rm -f "$W/seed/base.txt.bak" && echo other >"$W/seed/other.txt" \
    && git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m other && git -C "$W/seed" push -q origin main
git -C "$W/seed" checkout -q pr1 && git -C "$W/seed" rebase -q main && mkdir -p "$W/seed/.scratch" && echo note >"$W/seed/.scratch/n.md" \
    && git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m notes && git -C "$W/seed" push -q -f origin pr1:refs/pull/1/head && git -C "$W/seed" checkout -q main
new="$(head_of 1)"
state "1:$old"
echo '{}' >"$GHD/status-$new.json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && grep -q "^$new review success carried from $(echo "$old" | cut -c1-8)" "$GHD/posted" \
    && ok "review carry: same diff outside .scratch after a rebase -> review carried to the new head, merged" || bad "carry: exit $rc: $(cat "$W/out") posted $(cat "$GHD/posted" 2>/dev/null)"
# a reviewer's verdict on the new head is never overwritten by a carry: failure is red, pending waits
for verdict in failure pending; do
    git -C "$W/origin.git" update-ref refs/heads/main "$(git -C "$W/seed" rev-parse main)"
    rm -f "$GHD/posted" "$GHD/pr-1.json" "$GHD/log"
    echo "{\"review\":\"$verdict\"}" >"$GHD/status-$new.json"
    state "1:$old"
    "$LAND" "$S" >"$W/out" 2>&1; rc=$?
    want=3; [ "$verdict" = failure ] && want=2
    [ "$rc" = "$want" ] && [ "$(merges)" = 0 ] && [ ! -e "$GHD/posted" ] && grep -q "^#1 waits: review is $verdict on" "$W/out" \
        && ok "review carry: a $verdict review on the new head stays, the PR is not merged" || bad "carry over $verdict: exit $rc: $(cat "$W/out") posted $(cat "$GHD/posted" 2>/dev/null)"
done
# Check marks are never carried: the old head's check/windows success does not count on the new head
rm -f "$GHD/posted" "$GHD/pr-1.json" "$GHD/log"
echo '{}' >"$GHD/status-$new.json"
echo '{"review":"success","check/windows":"success"}' >"$GHD/status-$old.json"
state "1:$old/windows"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q "^#1 waits: check/windows is missing on" "$W/out" && ! grep -q ' check/windows ' "$GHD/posted" \
    && ok "checks: a Check mark is not carried to the new head, the PR waits for it" || bad "check carry: exit $rc: $(cat "$W/out") posted $(cat "$GHD/posted" 2>/dev/null)"
new_world nocarry 1
old="$(head_of 1)"
git -C "$W/seed" checkout -q pr1 && echo changed >"$W/seed/f1.txt" && git -C "$W/seed" commit -qam more && git -C "$W/seed" push -q -f origin pr1:refs/pull/1/head && git -C "$W/seed" checkout -q main
state "1:$old"
echo '{}' >"$GHD/status-$(head_of 1).json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && [ ! -e "$GHD/posted" ] && ok "review carry: a changed diff is not carried, the PR waits" || bad "nocarry: exit $rc: $(cat "$W/out") posted $(cat "$GHD/posted" 2>/dev/null)"
# the head the orchestrator verified moved and the PR changed: a review on the new head does not stand in for its verification
echo '{"review":"success"}' >"$GHD/status-$(head_of 1).json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q "^#1 waits: the head moved from .* and the PR's change differs" "$W/out" \
    && ok "verified head: a changed PR on a new head waits for the orchestrator, even with review success there" || bad "changed head: exit $rc: $(cat "$W/out")"

# --- checks: each listed Check mark must be success (skipped is posted as success); none listed — none needed ----------
new_world checks 1 2 3 4
state 1/windows 2/check/windows 3/windows 4
echo '{"review":"success","check/windows":"success"}' >"$GHD/status-$(head_of 2).json"
echo '{"review":"success","check/windows":"failure"}' >"$GHD/status-$(head_of 3).json"
echo '{"review":"success","check/windows":"failure"}' >"$GHD/status-$(head_of 4).json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
grep -q "^#1 waits: check/windows is missing on" "$W/out" && [ "$(merged_of 1)" = 0 ] && ok "checks: a listed Check without its mark waits" || bad "checks missing: $(cat "$W/out")"
[ "$(merged_of 2)" = 1 ] && ok "checks: a listed Check (named check/<name>) with success: merged" || bad "checks success: $(cat "$W/out")"
grep -q "^#3 waits: check/windows is failure on" "$W/out" && [ "$(merged_of 3)" = 0 ] && [ "$rc" = 2 ] && ok "checks: a failed Check is red" || bad "checks failure: exit $rc: $(cat "$W/out")"
[ "$(merged_of 4)" = 1 ] && ok "checks: a PR that lists no Check merges whatever marks its head has" || bad "checks none: $(cat "$W/out")"

# --- mergeable UNKNOWN: asked again 6 times, 10 s apart, then waits ----------------------------------------------
new_world unknown 1
state 1
echo UNKNOWN >"$GHD/mergeable-1"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: mergeable UNKNOWN after 6 retries' "$W/out" \
    && ok "UNKNOWN: waits after the retries, no merge" || bad "unknown: exit $rc: $(cat "$W/out")"
[ "$(tr '\n' ' ' <"$GHD/sleep.log")" = "10 10 10 10 10 10 " ] && [ "$(grep -c '^pr view 1 ' "$GHD/log")" = 8 ] \
    && ok "UNKNOWN: 6 waits of 10 s, 7 views under the lock (8 with the first)" || bad "unknown: sleeps [$(cat "$GHD/sleep.log")] views $(grep -c '^pr view 1 ' "$GHD/log")"
[ ! -e "$LAND_TEST_LOCK" ] && ok "UNKNOWN: the lock is released" || bad "unknown: lock left"
new_world unknown3 1
state 1
printf 'MERGEABLE\nUNKNOWN\nUNKNOWN\nUNKNOWN\nMERGEABLE\n' >"$GHD/mergeable-1"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && [ "$(wc -l <"$GHD/sleep.log" | tr -d ' ')" = 3 ] && ok "UNKNOWN 3 times, then MERGEABLE: merged after 3 waits" || bad "unknown3: exit $rc sleeps $(cat "$GHD/sleep.log" 2>/dev/null): $(cat "$W/out")"
new_world moved 1
state 1
echo 0123456789abcdef0123456789abcdef01234567 >"$GHD/moved-1"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q "^#1 waits: the head moved from $(head_of 1 | cut -c1-8) to 01234567" "$W/out" \
    && ok "a push between the check and the merge: waits, no gh pr merge" || bad "moved: exit $rc: $(cat "$W/out")"
# --- a base that moved is no reason to wait; only a conflict is ----------------------------------------
# BEHIND without a conflict, green ci-ok and review on the PR's own head: merged as it is, no rebase
new_world mss-BEHIND 1
state 1
echo '{"mergeStateStatus":"BEHIND"}' >"$GHD/pr-1.json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && [ "$(q "$S" 's.prs[0].result.status')" = merged ] && grep -q "^#1 merged " "$W/out" \
    && [ "$(git -C "$W/origin.git" show "refs/heads/main:f1.txt")" = 1 ] && ok "BEHIND + green ci-ok: merged without a rebase" || bad "BEHIND: exit $rc: $(cat "$W/out")"
grep -q "#1: BEHIND without a conflict — merging without a rebase" "${S%.json}.log" \
    && ok "BEHIND: the log says it merged without a rebase" || bad "BEHIND log: $(cat "${S%.json}.log" 2>/dev/null)"
! grep -v "^run list " "$GHD/log" | grep -q "update-branch\|push" && ok "BEHIND: land does not update the branch" || bad "BEHIND: gh $(cat "$GHD/log")"
# BEHIND with a red ci-ok on the head: the condition of the head still rules, no merge
new_world mss-BEHIND-red 1
state 1
echo '{"mergeStateStatus":"BEHIND"}' >"$GHD/pr-1.json"
echo '[{"id":1,"name":"ci-ok","status":"completed","conclusion":"failure","started_at":"2026-10-28T10:00:00Z"}]' >"$GHD/checks-$(head_of 1)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && [ "$(merges)" = 0 ] && grep -q "^#1 waits: ci-ok failure on" "$W/out" && ok "BEHIND + red ci-ok: red, no merge" || bad "BEHIND red: exit $rc: $(cat "$W/out")"
# BEHIND and the head moved between the check and the merge: still refused
new_world mss-BEHIND-moved 1
state 1
echo '{"mergeStateStatus":"BEHIND"}' >"$GHD/pr-1.json"
echo 0123456789abcdef0123456789abcdef01234567 >"$GHD/moved-1"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q "^#1 waits: the head moved from $(head_of 1 | cut -c1-8) to 01234567" "$W/out" \
    && ok "BEHIND + a moved head: waits, no gh pr merge" || bad "BEHIND moved: exit $rc: $(cat "$W/out")"
# BEHIND under strict protection (strict true): GitHub refuses the merge itself — the PR waits for a rebase
new_world mss-BEHIND-strict 1
state 1
echo '{"mergeStateStatus":"BEHIND"}' >"$GHD/pr-1.json"
touch "$GHD/merge-fail-1"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(q "$S" 's.prs[0].result.status')" = waits ] \
    && grep -q "^#1 waits: BEHIND: the base branch requires an up-to-date branch, rebase — gh pr merge exit 1" "$W/out" && [ ! -e "$LAND_TEST_LOCK" ] \
    && ok "BEHIND refused by GitHub (strict): waits for a rebase, the lock is released" || bad "BEHIND strict: exit $rc: $(cat "$W/out")"
# a conflict — DIRTY, or mergeable CONFLICTING — waits with the reason "conflict: rebase", and land rebases nothing
for st in DIRTY CONFLICTING; do
    new_world "mss-$st" 1
    state 1
    if [ "$st" = DIRTY ]; then echo '{"mergeStateStatus":"DIRTY"}' >"$GHD/pr-1.json"; else echo CONFLICTING >"$GHD/mergeable-1"; fi
    "$LAND" "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q "^#1 waits: conflict: rebase — the PR conflicts with its base" "$W/out" && [ ! -e "$LAND_TEST_LOCK" ] \
        && ok "$st: waits with \"conflict: rebase\", no merge" || bad "$st: exit $rc: $(cat "$W/out")"
    ! grep -v "^run list " "$GHD/log" | grep -q "update-branch\|push" && ok "$st: land does not update the branch" || bad "$st: gh $(cat "$GHD/log")"
done

# --- the lock: waited for while another holds it, a stuck one removed, released on a refused merge -------------------
new_world lockwait 1
state 1
mkdir "$LAND_TEST_LOCK"; : >"$GHD/unlock-on-sleep"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(head -n 2 "$GHD/sleep.log" | tr '\n' ' ')" = "30 30 " ] && [ "$(head -n 1 "$GHD/locks")" = "1 held" ] \
    && ok "lock: a held lock is waited for (30 s polls), then taken for the merge" || bad "lockwait: exit $rc sleeps $(cat "$GHD/sleep.log" 2>/dev/null) locks $(cat "$GHD/locks" 2>/dev/null)"
new_world lockstale 1
state 1
mkdir "$LAND_TEST_LOCK"; touch -t 202001010000 "$LAND_TEST_LOCK"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ ! -s "$GHD/sleep.log" ] && grep -q "stuck, removed" "$W/state.log" && ok "lock: one older than 90 min is removed as stuck" || bad "lockstale: exit $rc: $(cat "$W/out")"
new_world lockfail 1 2
state 1 2
: >"$GHD/merge-fail-1"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
grep -q '^#1 waits: gh pr merge failed (exit 1): Pull request #1 is not mergeable' "$W/out" && [ "$(cat "$GHD/locks")" = "$(printf '1 held\n2 held\n900 held')" ] && [ ! -e "$LAND_TEST_LOCK" ] \
    && ok "lock: released after a refused merge, the next PR takes it again" || bad "lockfail: $(cat "$W/out") locks $(cat "$GHD/locks")"

# the merge condition is read again once the lock is taken: a review that turned failure while land waited stops the merge
new_world lockrecheck 1
state 1
mkdir "$LAND_TEST_LOCK" "$GHD/on-sleep"; : >"$GHD/unlock-on-sleep"
echo '{"review":"failure"}' >"$GHD/on-sleep/status-$(head_of 1).json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: review is failure on' "$W/out" && [ ! -e "$LAND_TEST_LOCK" ] \
    && ok "lock: the review is read again under the lock; a failure posted while land waited stops the merge" || bad "lockrecheck: exit $rc: $(cat "$W/out")"
# merged by someone else while land waited for the lock, before GitHub filled the merge commit
new_world lockmerged 1
state 1
mkdir "$LAND_TEST_LOCK" "$GHD/on-sleep"; : >"$GHD/unlock-on-sleep"
echo '{"state":"MERGED"}' >"$GHD/on-sleep/pr-1.json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
grep -qx '#1 merged unknown' "$W/out" && [ "$(merged_of 1)" = 0 ] && ok "lock: a PR merged meanwhile with no merge commit yet is recorded as 'merged unknown'" || bad "lockmerged: exit $rc: $(cat "$W/out")"

# --- a kill after the first merge, then the same command again --------------------------------------------------
new_world resume 1 2
state 1 2
: >"$GHD/kill-after-merge-1"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
# exit 137 (128 + SIGKILL); on Windows a killed process ends with exit code 1
{ [ "$rc" = 137 ] || { on_windows && [ "$rc" = 1 ]; }; } && [ "$(merged_of 1)" = 1 ] && [ "$(merged_of 2)" = 0 ] && ok "resume: killed right after the merge of PR 1 (exit $rc)" || bad "resume: first run exit $rc: $(cat "$GHD/log")"
rm -f "$GHD/kill-after-merge-1"
# the killed run left its lock (SIGKILL runs no handler): it counts as stuck once older than LAND_LOCK_STALE_S
[ -d "$LAND_TEST_LOCK" ] && touch -t 202001010000 "$LAND_TEST_LOCK"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && [ "$(merged_of 2)" = 1 ] && grep -q '^#1 merged [0-9a-f]\{40\}$' "$W/out" && grep -q '^#2 merged ' "$W/out" \
    && ok "resume: PR 2 merged, PR 1 not merged again" || bad "resume: exit $rc: $(cat "$W/out") merges $(grep '^pr merge' "$GHD/log")"
[ "$(grep -c '^pr create' "$GHD/log")" = 1 ] && [ "$(wc -l <"$GHD/ticket.log" | tr -d ' ')" = 2 ] && ok "resume: one documents PR for both tickets" || bad "resume: docs $(grep '^pr create' "$GHD/log") tickets $(cat "$GHD/ticket.log")"

# --- SIGTERM while the lock is held: released -----------------------------------------------------------------
new_world term 1
state 1
echo UNKNOWN >"$GHD/mergeable-1"
unset LAND_SLEEP
LAND_RETRY_S=30 "$LAND" "$S" >"$W/out" 2>&1 & lp=$!
n=100; until [ -d "$LAND_TEST_LOCK" ] || [ "$n" = 0 ]; do sleep 0.1; n=$((n - 1)); done
kill -TERM "$lp" 2>/dev/null; wait "$lp"; rc=$?
export LAND_SLEEP="$STUBS/sleep.mjs"
if on_windows; then
    echo "skip SIGTERM: a kill from Git Bash ends node on Windows without running its signal handlers"
else
    [ "$rc" = 143 ] && [ ! -e "$LAND_TEST_LOCK" ] && [ "$(merges)" = 0 ] && ok "SIGTERM while waiting under the lock: exit 143, lock released" || bad "term: exit $rc lock $([ -e "$LAND_TEST_LOCK" ] && echo left)"
fi

# --- --watch: a run in progress finishes, the next pass merges ---------------------------------------------------
new_world watch 1
state 1
running "$(head_of 1)"; : >"$GHD/runs-done-on-sleep"
"$LAND" "$S" --watch >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && [ "$(head -n 1 "$GHD/sleep.log")" = 300 ] && ok "watch: waits 300 s while CI runs, merges on the next pass" || bad "watch: exit $rc sleeps $(cat "$GHD/sleep.log" 2>/dev/null): $(cat "$W/out")"
new_world nowatch 1
state 1
running "$(head_of 1)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ ! -e "$GHD/sleep.log" ] && ok "without --watch: one pass, no wait" || bad "nowatch: exit $rc sleeps $(cat "$GHD/sleep.log" 2>/dev/null)"

# --- the documents: a red documents check is red, nothing pushed; the input is checked -----------------------------
new_world docsred 1
state 1
echo 1 >"$GHD/docs-check-rc"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && [ "$(merged_of 1)" = 1 ] && ! grep -q '^pr create' "$GHD/log" && grep -q '^documents land-docs/.* waits: .* exited 1' "$W/out" \
    && ok "docs: a red documents check -> no documents PR, LAND=red" || bad "docsred: exit $rc: $(cat "$W/out")"
rm -f "$GHD/docs-check-rc"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(grep -c '^pr create' "$GHD/log")" = 1 ] && [ "$(merged_of 1)" = 1 ] && ok "docs: the next run opens and merges the documents PR, PR 1 not merged again" || bad "docsred rerun: exit $rc: $(cat "$W/out")"
new_world ticketfail 1
state 1
: >"$GHD/ticket-fail"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merged_of 1)" = 1 ] && ! grep -q '^pr create' "$GHD/log" && grep -q '^documents land-docs/.* waits: ticket done e 01 failed (exit 1)' "$W/out" \
    && [ -z "$(git -C "$W/origin.git" for-each-ref 'refs/heads/land-docs/*')" ] \
    && ok "docs: a failed ticket done -> nothing pushed, no documents PR, LAND=unverified" || bad "ticketfail: exit $rc: $(cat "$W/out")"
rm -f "$GHD/ticket-fail"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(grep -c '^pr create' "$GHD/log")" = 1 ] && [ "$(merged_of 1)" = 1 ] && ok "docs: after a failed ticket done the next run opens and merges the documents PR" || bad "ticketfail rerun: exit $rc: $(cat "$W/out")"
# a documents PR closed without a merge does not cover its tickets: the next run opens another one for them
new_world docsclosed 1
state 1
: >"$GHD/merge-fail-900"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
grep -q '^#900 waits: gh pr merge failed' "$W/out" && [ "$(merged_of 1)" = 1 ] || bad "docsclosed: setup: exit $rc: $(cat "$W/out")"
rm -f "$GHD/merge-fail-900"; echo '{"state":"CLOSED"}' >"$GHD/pr-900.json"; : >"$GHD/ticket.log"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && grep -qx '#901 merged [0-9a-f]\{40\}' "$W/out" && [ "$(merged_of 1)" = 1 ] && [ "$(merged_of 900)" = 1 ] \
    && [ "$(cat "$GHD/ticket.log")" = "done e 01 --pr 1 root-in-cwd=true" ] && [ "$(q "$S" 's.docs[0].closed')" = "[900]" ] \
    && ok "docs: a documents PR closed unmerged -> a new documents PR with its tickets, merged" || bad "docsclosed: exit $rc: $(cat "$W/out") tickets $(cat "$GHD/ticket.log")"
# tickets_root: another root inside the repository is where ticket done writes and what the documents commit holds
new_world root 1
state 1
node -e 'const fs=require("fs"),s=JSON.parse(fs.readFileSync(process.argv[1]));s.tickets_root="work/tickets/";fs.writeFileSync(process.argv[1],JSON.stringify(s))' "$S"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(git -C "$W/origin.git" show --name-only --format= refs/pull/900/head)" = "work/tickets/e/issues/01.md" ] \
    && ok "docs: tickets_root from the state file is the root of ticket done" || bad "root: exit $rc: $(cat "$W/out") files $(git -C "$W/origin.git" show --name-only --format= refs/pull/900/head 2>&1)"
# the input: a tickets root outside the repository or the repository itself (it would exclude the whole diff when two heads
# are compared), the old scope rule and a PR without its checks are refused
i=0
for bad_input in 's.tickets_root="/abs/.scratch"' 's.tickets_root="../.scratch"' 's.tickets_root="."' 's.tickets_root="./"' 's.tickets_root="a/.."' 's.scope=null' 'delete s.prs[0].checks' 's.prs[0].checks=["two words"]' \
    's.prs[0].evidence={}' 's.prs[0].evidence=[{item:0,kind:"review",verdict:"pass",ref:"r",sha:"abc1234"}]' 's.prs[0].evidence=[{item:1,kind:"review",verdict:"pass",ref:""}]' \
    's.prs[0].evidence=[{item:1,kind:"review",verdict:"pass",ref:"r"}]' 's.prs[0].evidence=[{item:1,kind:"review",verdict:"pass",ref:"r",sha:"abc1234"}];delete s.prs[0].ticket'; do
    i=$((i + 1)); new_world "input$i" 1
    state 1
    node -e "const fs=require('fs'),s=JSON.parse(fs.readFileSync(process.argv[1]));$bad_input;fs.writeFileSync(process.argv[1],JSON.stringify(s))" "$S"
    "$LAND" "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" = 1 ] && [ ! -s "$GHD/log" ] && ok "input: $bad_input is refused before any gh call" || bad "input $bad_input: exit $rc: $(cat "$W/out")"
done
new_world silent 1
state 1
node -e 'const fs=require("fs"),s=JSON.parse(fs.readFileSync(process.argv[1]));s.tickets_root=null;fs.writeFileSync(process.argv[1],JSON.stringify(s))' "$S"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && ! grep -q '^pr create' "$GHD/log" && [ ! -e "$GHD/ticket.log" ] && ok "docs: tickets_root null -> merged, no documents PR, no ticket done" || bad "silent: exit $rc: $(cat "$W/out")"
# --- Evidence lines: prs[].evidence goes into the documents PR through `ticket evidence`, before `ticket done` -----------
# edit <js>: change the state file with a line of JavaScript on s
EV2='[{item:1,kind:"review",verdict:"pass",ref:"PR #1 review"},{item:2,kind:"ci-check",verdict:"pass",ref:"PR #1 ci-ok"}]'
# the real ticket script: main has the ticket e/01 with two items in "## Done when"
ticket_world() {
    new_world "$1" 1
    mkdir -p "$W/seed/.scratch/e/issues"
    printf '# 01 — one\n\nStatus: open\n\n## Done when\n\n- [ ] the first\n- [ ] the second\n      on two lines\n\n## Where in the code\n\n- f1.txt\n' >"$W/seed/.scratch/e/issues/01-one.md"
    git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m ticket && git -C "$W/seed" push -q origin main
}
ticket_world evreal
h1="$(head_of 1)"
state "1:$h1"
edit "s.prs[0].evidence=$EV2"
LAND_TICKET= "$LAND" "$S" >"$W/out" 2>&1; rc=$?
# the file at <ref>:<path> is read through node: Git Bash on Windows rewrites a `<ref>:<path>` argument of a shell
# command as a path list (`:` to `;`, `/` to `\`), and git then finds no such revision
doc="$(node -e 'process.stdout.write(require("child_process").execFileSync("git", ["-C", process.argv[1], "show", `${process.argv[2]}:${process.argv[3]}`], { encoding: "utf8" }))' "$W/origin.git" refs/pull/900/head .scratch/e/issues/01-one.md 2>&1)"
want="$(printf -- '- [ ] the first\n  - evidence: review pass · PR #1 review · - - · %s\n- [ ] the second\n      on two lines\n  - evidence: ci-check pass · PR #1 ci-ok · ci - · %s' "$h1" "$h1")"
[ "$rc" = 0 ] && [[ "$doc" == *"$want"* ]] && grep -q '^Status: done ' <<<"$doc" && grep -qx 'PR: #1' <<<"$doc" \
    && ok "evidence: review pass and ci-check pass -> two Evidence lines under their items in the documents PR, Status done, sha of prs[].head" || bad "evidence real: exit $rc: $(cat "$W/out") ticket: $doc"
# an item the section has not: the documents PR waits with the reason, nothing pushed
ticket_world evbad
state "1:$(head_of 1)"
edit 's.prs[0].evidence=[{item:9,kind:"review",verdict:"pass",ref:"PR #1 review"}]'
LAND_TICKET= "$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merged_of 1)" = 1 ] && ! grep -q '^pr create' "$GHD/log" && [ -z "$(git -C "$W/origin.git" for-each-ref 'refs/heads/land-docs/*')" ] \
    && grep -q '^documents land-docs/.* waits: ticket evidence e 01 9 review failed (exit 2): .*no item 9' "$W/out" && [[ "$(q "$S" 's.docs[0].result.reason')" == *"no item 9"* ]] \
    && ok "evidence: an item outside the section -> waits, no documents PR, the state file names the reason" || bad "evidence bad item: exit $rc: $(cat "$W/out") docs $(q "$S" 's.docs')"
# both calls get the tickets root inside the documents worktree; the defaults of platform, copy and sha
new_world evroot 1
h1="$(head_of 1)"
state "1:$h1"
edit "s.tickets_root='work/tickets';s.prs[0].evidence=$EV2"
LAND_EVIDENCE_CHECK="$STUBS/evidence-check.mjs" "$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$GHD/ticket.log")" = "$(printf 'evidence e 01 1 review pass --ref PR #1 review --platform - --copy - --sha %s root=work/tickets\nevidence e 01 2 ci-check pass --ref PR #1 ci-ok --platform ci --copy - --sha %s root=work/tickets\ndone e 01 --pr 1 root-in-cwd=true' "$h1" "$h1")" ] \
    && ok "evidence: ticket evidence before ticket done, --root <tree>/<tickets_root>, platform - and ci, copy -, sha prs[].head" || bad "evidence root: exit $rc: $(cat "$W/out") ticket $(cat "$GHD/ticket.log")"
[ "$(cat "$GHD/evidence-check.log" 2>/dev/null)" = "--changed --root work/tickets --base refs/remotes/origin/main cwd=state.json.docs" ] \
    && ok "evidence: evidence-check --changed --root <tree>/<tickets_root> --base <remote>/<branch> in the documents worktree" || bad "evidence-check call: $(cat "$GHD/evidence-check.log" 2>/dev/null)"
# a finding in the documents worktree: nothing pushed, red, the value not in the output
new_world evleak 1
state 1
leak="gh""p_$(printf 'Zq%.0s' $(seq 1 15))"
printf 'token %s\n' "$leak" >"$GHD/ticket-leak"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && tail -n 1 "$W/out" | grep -qx 'LAND=red' && [ "$(merged_of 1)" = 1 ] && ! grep -q '^pr create\|^pr list' "$GHD/log" \
    && [ -z "$(git -C "$W/origin.git" for-each-ref 'refs/heads/land-docs/*')" ] && [ "$(q "$S" 's.docs[0].result.status + " " + s.docs[0].result.kind')" = "waits red" ] \
    && grep -q '^documents land-docs/.* waits: evidence-check found 1 findings' "$W/out" \
    && ok "evidence-check: a finding in the documents worktree -> no push, no documents PR, docs result red" || bad "evidence leak: exit $rc: $(cat "$W/out") docs $(q "$S" 's.docs')"
! grep -qF "$leak" "$W/out" "$S" "$W/state.log" && ok "evidence-check: the full value is in neither the output, the state file nor the log" || bad "evidence leak: the value is printed"
# Silent mode: no documents PR, so no ticket evidence; land says whose the lines are (no head needed then)
new_world evsilent 1
state 1
edit "s.tickets_root=null;s.prs[0].evidence=$EV2"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ ! -e "$GHD/ticket.log" ] && grep -qx "evidence of #1 is the orchestrator's (tickets outside the repository)" "$W/out" \
    && ok "evidence: tickets_root null -> no ticket evidence, the line 'evidence of #1 is the orchestrator's'" || bad "evidence silent: exit $rc: $(cat "$W/out")"
new_world input 1
state 1
node -e 'const fs=require("fs"),s=JSON.parse(fs.readFileSync(process.argv[1]));s.ci="batch";fs.writeFileSync(process.argv[1],JSON.stringify(s))' "$S"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 1 ] && grep -q 'batch' "$W/out" && [ ! -s "$GHD/log" ] && ok "input: workflow.ci batch is refused before any gh call" || bad "input batch: exit $rc: $(cat "$W/out")"
"$LAND" >"$W/out" 2>&1; rc=$?
[ "$rc" = 1 ] && grep -q 'usage: land' "$W/out" && ok "input: no state file -> usage, exit 1" || bad "input usage: exit $rc"

# --- a red push run on main: a code PR waits naming the culprit, documents merge, a rerun that passed is green --------
# sha <c>: a SHA of 40 times the character c
sha() { printf "$1%.0s" $(seq 1 40); }
# mrun <id> <sha> <status> <conclusion> <attempt> <createdAt> [<updatedAt>]: one push run of main as `gh run list --json` prints it
mrun() { printf '{"databaseId":%s,"headSha":"%s","status":"%s","conclusion":"%s","attempt":%s,"createdAt":"%s","updatedAt":"%s","url":"https://github.com/o/r/actions/runs/%s"}' "$1" "$2" "$3" "$4" "$5" "$6" "${7:-$6}" "$1"; }
# main_runs <run>…: the push runs of main, newest first
main_runs() { local s="" sep=""; for r in "$@"; do s="$s$sep$r"; sep=","; done; printf '[%s]\n' "$s" >"$GHD/main-runs"; }
# docs_pr <N>: PR N changes documents only: one note under notes/, its name in Cyrillic with a space, a path git would quote
docs_pr() {
    git -C "$W/seed" checkout -q -b "d$1" main && mkdir -p "$W/seed/notes" && echo note >"$W/seed/notes/заметка $1.md" && git -C "$W/seed" add -A \
        && git -C "$W/seed" commit -q -m "docs $1" && git -C "$W/seed" push -q origin "d$1:refs/pull/$1/head" && git -C "$W/seed" checkout -q main
}
C1="$(sha 1)" C2="$(sha 2)" C3="$(sha 3)" C4="$(sha 4)"
R1="$(mrun 1 "$C1" completed success 1 2026-11-09T09:00:00Z 2026-11-09T09:40:00Z)"
# red_main: run 3 (newest) and run 2 red, run 1 green: run 2 is the first red one after the last green one, and its commit
# is the merge commit of PR 41; $NEWER — a newer run before them
red_main() {
    main_runs ${NEWER:+"$NEWER"} "$(mrun 3 "$C3" completed failure 1 2026-11-09T10:10:00Z 2026-11-09T10:50:00Z)" "$(mrun 2 "$C2" completed failure 1 2026-11-09T10:00:00Z 2026-11-09T10:30:00Z)" "$R1"
    printf '[{"number":40,"merge_commit_sha":"%s"},{"number":41,"merge_commit_sha":"%s"}]' "$C1" "$C2" >"$GHD/pulls-$C2"
}
RED_LINE='main red since 22222222 (#41, 2026-11-09T10:30:00Z) — code PRs wait; fix forward until 2026-11-09T11:30:00Z, then revert #41'
RED_REASON='#1 waits: main red since 22222222 (#41, 2026-11-09T10:30:00Z), run https://github.com/o/r/actions/runs/2 — code PRs wait; fix forward until 2026-11-09T11:30:00Z, then revert #41'
new_world mainred 1
state 1
red_main
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qxF "$RED_REASON" "$W/out" && tail -n 1 "$W/out" | grep -qx 'LAND=unverified' && [ "$(q "$S" 's.prs[0].result.kind')" = waits ] \
    && ok "red main: a code PR waits; the reason names the first red run after the green one, its commit and PR #41; exit 3" || bad "red main: exit $rc: $(cat "$W/out")"
grep -qxF "$RED_LINE" "$W/out" && [ "$(tail -n 2 "$W/out" | head -n 1)" = "$RED_LINE" ] \
    && ok "red main: one line for the orchestrator before the verdict — since, culprit, fix forward until +1 h, then revert" || bad "red main line: $(cat "$W/out")"
grep -q '^run list --workflow ci.yml --branch main --event push ' "$GHD/log" && grep -q "^api repos/{owner}/{repo}/commits/$C2/pulls" "$GHD/log" \
    && ok "red main: the push runs of main come from gh run list, the culprit PR from the commit's PRs" || bad "red main gh: $(cat "$GHD/log")"
! grep -q '^run rerun\|revert\|^workflow run' "$GHD/log" && [ "$(git -C "$W/origin.git" rev-list --count main)" = 1 ] \
    && ok "red main: land reruns nothing and reverts nothing" || bad "red main: gh $(cat "$GHD/log")"
# the marker of a red main branch, <gate state>/main-red-<key>.json: written while main is red, kept while gh cannot read
# the push runs and while the red run is being rerun, removed once main is not red. The key is the gate registry's entry
# for the checkout (gate-resolve.mjs --which): a test registry whose entry matches every world of this file.
new_world mainmarker 1
gate_state mainmarker
state 1
red_main
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ -f "$MR" ] && [ "$(q "$MR" 's.sha')" = "$C2" ] && [ "$(q "$MR" 's.pr')" = 41 ] && [ "$(q "$MR" 's.url')" = https://github.com/o/r/actions/runs/2 ] \
    && [ "$(q "$MR" 's.since')" = 2026-11-09T10:30:00Z ] && [ "$(q "$MR" 's.line')" = "$RED_LINE" ] && [ "$(q "$MR" '/^\d{4}-\d\d-\d\dT[\d:]+Z$/.test(s.at)')" = true ] \
    && ok "main-red marker: the latest completed push run red -> land writes main-red-<key>.json with the sha, the culprit PR and the run's URL" || bad "main-red marker written: exit $rc: $(cat "$MR" 2>&1) $(cat "$W/out")"
[ "$(ls -A "$GATE_STATE")" = main-red-land-test.json ] && ok "main-red marker: written by rename, no temporary file left" || bad "main-red marker leftovers: $(ls -A "$GATE_STATE")"
before="$(cat "$MR")"
: >"$GHD/main-runs-fail"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(cat "$MR" 2>&1)" = "$before" ] && ok "main-red marker: gh cannot read the push runs -> the marker is kept as it was" || bad "main-red marker gh fail: exit $rc: $(cat "$MR" 2>&1)"
rm -f "$GHD/main-runs-fail"
NEWER="$(mrun 5 "$C4" in_progress "" 2 2026-11-09T11:00:00Z)" red_main
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: the push run .* is being rerun (attempt 2)' "$W/out" && [ "$(cat "$MR" 2>&1)" = "$before" ] \
    && ok "main-red marker: the newest push run is being rerun (attempt 2, not completed) -> the marker is kept, main is still red" || bad "main-red marker rerun: exit $rc: $(cat "$MR" 2>&1) $(cat "$W/out")"
NEWER="$(mrun 5 "$C4" completed success 2 2026-11-09T11:00:00Z 2026-11-09T11:20:00Z)" red_main
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && [ ! -e "$MR" ] \
    && ok "main-red marker: the rerun's green verdict -> the next run of land sees main green and removes the marker" || bad "main-red marker removed: exit $rc: $(ls -A "$GATE_STATE") $(cat "$W/out")"
# a marker left by an earlier run, and the latest completed push run green: removed, no other file written
new_world mainmarker-green 1
gate_state mainmarker-green
state 1
echo '{"sha":"x"}' >"$MR"
main_runs "$(mrun 2 "$C2" completed success 1 2026-11-09T10:00:00Z)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ -z "$(ls -A "$GATE_STATE")" ] && grep -q 'main-red marker: main is not red, removed' "$W/state.log" \
    && ok "main-red marker: land finds main green -> the marker of an earlier run is removed, logged" || bad "main-red marker green: exit $rc: $(ls -A "$GATE_STATE")"
# no entry of the gate registry for the checkout: no key, no marker, the PR still waits on the red main
new_world mainmarker-nokey 1
gate_state mainmarker-nokey
state 1
red_main
CLAUDE_GATE_CONFIG="$(tn "$T/no-registry.json")" "$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && grep -qxF "$RED_REASON" "$W/out" && [ -z "$(ls -A "$GATE_STATE")" ] && grep -q 'main-red marker: no gate key' "$W/state.log" \
    && ok "main-red marker: the gate registry cannot name the checkout's key -> no marker, logged, the PR waits as before" || bad "main-red marker no key: exit $rc: $(ls -A "$GATE_STATE") $(cat "$W/out")"
# the culprit's commit has no PR (a direct push): the commit is what to revert
new_world mainred-nopr 1
state 1
red_main; rm -f "$GHD/pulls-$C2"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qxF 'main red since 22222222 (no PR, 2026-11-09T10:30:00Z) — code PRs wait; fix forward until 2026-11-09T11:30:00Z, then revert 22222222' "$W/out" \
    && ok "red main: a culprit commit with no PR is named by its SHA" || bad "red main no PR: exit $rc: $(cat "$W/out")"
# documents only merge while main is red, by the project's rule (docs_only); with no rule every PR counts as code
new_world maindocs 1
docs_pr 2
state 1 2
export DOCS_ONLY="node \"$(tn "$STUBS/docs-only.mjs")\""
edit 's.docs_only=process.env.DOCS_ONLY'
red_main
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merged_of 2)" = 1 ] && [ "$(merged_of 1)" = 0 ] && grep -qxF "$RED_REASON" "$W/out" && grep -q '^#2 merged ' "$W/out" \
    && ok "red main: a PR with documents only merges, the code PR waits" || bad "red main docs: exit $rc: $(cat "$W/out")"
# PR 2 is asked twice: before the lock and under it
[ "$(cat "$GHD/docs-only.log")" = "$(printf 'f1.txt cwd=repo\nnotes/заметка 2.md cwd=repo\nnotes/заметка 2.md cwd=repo')" ] \
    && ok "red main: the docs_only rule gets the PR's changed paths on stdin, in the checkout, again under the lock" || bad "red main docs paths: $(cat "$GHD/docs-only.log" 2>/dev/null)"
[ "$(merged_of 900)" = 1 ] && ok "red main: the documents PR of land merges" || bad "red main documents PR: $(cat "$W/out")"
new_world maindocs-norule 2
docs_pr 3
state 3
red_main
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#3 waits: main red since 22222222' "$W/out" \
    && ok "red main: with no docs_only rule a documents PR counts as code and waits" || bad "red main no rule: exit $rc: $(cat "$W/out")"
new_world maindocs-rc 2
docs_pr 3
state 3
edit 's.docs_only=process.env.DOCS_ONLY'
red_main; echo 2 >"$GHD/docs-only-rc"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#3 waits: main red since 22222222' "$W/out" \
    && ok "red main: a docs_only rule that exits neither 0 nor 1 counts the PR as code" || bad "red main rule exit 2: exit $rc: $(cat "$W/out")"
# the fix of the red main branch (main_fix) merges while it is red
new_world mainfix 1
state 1
edit 's.prs[0].main_fix=true'
red_main
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && ok "red main: a PR marked main_fix merges while main is red" || bad "red main fix: exit $rc: $(cat "$W/out")"

# --- main red on another machine (red_elsewhere): an open issue of its label holds the PRs its scope command names ------
# worfy: the label pc-main-red, the command scripts/windows-verdict-scope.mjs <base> <head> (exit 1 — scope pc)
export NEEDS="node \"$(tn "$STUBS/scope.mjs")\" <base> <head>"
elsewhere() { edit 's.red_elsewhere={label:"pc-main-red",needs:process.env.NEEDS}'; }
issue_open() { printf '[{"number":1513,"title":"PC gate full red on %s","url":"https://github.com/o/r/issues/1513"}]\n' "$C2" >"$GHD/issues"; }
HELD_REASON="#1 waits: main is red elsewhere: open pc-main-red issue #1513 \"PC gate full red on $C2\" https://github.com/o/r/issues/1513 — the PR needs that machine (red_elsewhere.needs exit 1) and waits until the issue is closed"
new_world elsewhere 1 2
state 1 2
elsewhere; issue_open
echo 0 >"$GHD/scope-$(head_of 2)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merged_of 1)" = 0 ] && grep -qxF "$HELD_REASON" "$W/out" && tail -n 1 "$W/out" | grep -qx 'LAND=unverified' && [ "$(q "$S" 's.prs[0].result.kind')" = waits ] \
    && ok "red elsewhere: an open issue of the label holds a PR the scope command names (exit 1); the reason names the issue, its title and URL; exit 3" || bad "red elsewhere held: exit $rc: $(cat "$W/out")"
[ "$(merged_of 2)" = 1 ] && grep -q '^#2 merged ' "$W/out" && grep -q "Z #2: red_elsewhere.needs exit 0 — merged while pc-main-red issue #1513 is open" "$W/state.log" \
    && ok "red elsewhere: a PR the scope command does not name (exit 0) merges while the issue is open, the log says why" || bad "red elsewhere runner: $(cat "$W/out") $(grep '#2' "$W/state.log")"
grep -qx 'issue list --label pc-main-red --state open --json number,title,url' "$GHD/log" \
    && ok "red elsewhere: the open issues come from gh issue list --label <label> --state open" || bad "red elsewhere gh: $(grep '^issue' "$GHD/log")"
fork1="$(git -C "$W/origin.git" rev-parse "$(head_of 1)~1")"
grep -qx "$fork1 $(head_of 1) cwd=repo" "$GHD/scope.log" \
    && ok "red elsewhere: the scope command gets the PR's fork point and head, in the checkout of the main branch" || bad "red elsewhere scope args: $(cat "$GHD/scope.log" 2>/dev/null) want $fork1"
# a PR with documents only and a PR marked main_fix merge while the issue is open; the scope command is not asked
new_world elsewhere-docs 1
docs_pr 2
state 2
edit 's.docs_only=process.env.DOCS_ONLY'
elsewhere; issue_open
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 2)" = 1 ] && [ ! -e "$GHD/scope.log" ] && grep -q 'Z #2: documents only — merged while pc-main-red issue #1513 is open' "$W/state.log" \
    && ok "red elsewhere: a PR with documents only merges while the issue is open, the log says why" || bad "red elsewhere docs: exit $rc: $(cat "$W/out")"
new_world elsewhere-fix 1
state 1
edit 's.prs[0].main_fix=true'
elsewhere; issue_open
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && [ ! -e "$GHD/scope.log" ] && grep -q 'Z #1: main_fix — not held by open pc-main-red issues' "$W/state.log" \
    && ok "red elsewhere: a PR marked main_fix merges while the issue is open, the log says why" || bad "red elsewhere fix: exit $rc: $(cat "$W/out")"
# gh unable to read the issues, a scope command that exits neither 0 nor 1: the PR waits unverified, no merge
new_world elsewhere-ghfail 1
state 1
elsewhere; issue_open; : >"$GHD/issues-fail"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: the open pc-main-red issues: gh exit 1: HTTP 502' "$W/out" && tail -n 1 "$W/out" | grep -qx 'LAND=unverified' \
    && ok "red elsewhere: gh issue list fails -> the PR waits (unverified), no merge" || bad "red elsewhere gh fail: exit $rc: $(cat "$W/out")"
new_world elsewhere-scopefail 1
state 1
elsewhere; issue_open; echo 2 >"$GHD/scope-$(head_of 1)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: main is red elsewhere: open pc-main-red issue #1513 .* — red_elsewhere.needs exit 2, not 0 or 1: unverified, the PR waits' "$W/out" && tail -n 1 "$W/out" | grep -qx 'LAND=unverified' \
    && ok "red elsewhere: a scope command that exits neither 0 nor 1 -> the PR waits (unverified), no merge" || bad "red elsewhere scope fail: exit $rc: $(cat "$W/out")"
# no open issue: the PR merges and the scope command is not asked; without red_elsewhere no issue is read at all
new_world elsewhere-closed 1
state 1
elsewhere
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && [ ! -e "$GHD/scope.log" ] \
    && ok "red elsewhere: no open issue of the label -> the PR merges, the scope command is not asked" || bad "red elsewhere closed: exit $rc: $(cat "$W/out")"
new_world elsewhere-off 1
state 1
issue_open
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && ! grep -q '^issue list' "$GHD/log" \
    && ok "red elsewhere: without red_elsewhere in the state file land reads no issue and merges as before" || bad "red elsewhere off: exit $rc: $(cat "$W/out")"
# read again under the lock: the issue opened while land waited for it
new_world elsewhere-lock 1
state 1
elsewhere
mkdir "$LAND_TEST_LOCK" "$GHD/on-sleep"; : >"$GHD/unlock-on-sleep"
issue_open; mv "$GHD/issues" "$GHD/on-sleep/issues"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qxF "$HELD_REASON" "$W/out" && [ ! -e "$LAND_TEST_LOCK" ] \
    && ok "red elsewhere: read again under the lock; the issue opened while land waited, no merge" || bad "red elsewhere lock: exit $rc: $(cat "$W/out")"
# flaky: the red run's failed jobs were rerun once and passed — its latest attempt is green, so main is green
new_world mainflaky 1
state 1
main_runs "$(mrun 3 "$C3" completed success 2 2026-11-09T10:10:00Z 2026-11-09T11:20:00Z)" "$(mrun 2 "$C2" completed failure 1 2026-11-09T10:00:00Z)" "$R1"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && ! grep -q 'main red' "$W/out" \
    && ok "flaky: the latest push run red, then green after a rerun of its failed jobs (attempt 2) — main green, merged" || bad "flaky: exit $rc: $(cat "$W/out")"
new_world maingreen 1
state 1
main_runs "$(mrun 2 "$C2" completed success 1 2026-11-09T10:00:00Z)" "$(mrun 1 "$C1" completed failure 1 2026-11-09T09:00:00Z)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && ! grep -q 'main red' "$W/out" && ok "green main: the latest completed push run green, merged" || bad "green main: exit $rc: $(cat "$W/out")"
# a push run in progress gives no verdict: the latest completed one decides; a cancelled one gives none either
new_world mainrunning 1
state 1
main_runs "$(mrun 4 "$C4" in_progress "" 1 2026-11-09T11:00:00Z)" "$(mrun 3 "$C3" completed cancelled 1 2026-11-09T10:10:00Z)" "$(mrun 2 "$C2" completed success 1 2026-11-09T10:00:00Z)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && ok "in progress: a push run in progress and a cancelled one are passed over, the green one before them decides, merged" || bad "main running: exit $rc: $(cat "$W/out")"
new_world mainrunning-red 1
state 1
NEWER="$(mrun 4 "$C4" queued "" 1 2026-11-09T11:00:00Z)" red_main
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qxF "$RED_REASON" "$W/out" && [ "$(q "$S" 's.prs[0].result.kind')" = ci ] \
    && ok "in progress: a newer push run in progress does not lift a red one; the PR waits for CI (a later pass may merge it)" || bad "main running red: exit $rc: $(cat "$W/out") $(cat "$GHD/main-runs")"
new_world mainrerun 1
state 1
main_runs "$(mrun 3 "$C3" in_progress "" 2 2026-11-09T10:10:00Z)" "$(mrun 2 "$C2" completed success 1 2026-11-09T10:00:00Z)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qxF '#1 waits: the push run https://github.com/o/r/actions/runs/3 on main (33333333) is being rerun (attempt 2): code PRs wait for its verdict' "$W/out" \
    && [ "$(q "$S" 's.prs[0].result.kind')" = ci ] && ok "in progress: the newest push run being rerun holds code PRs until its verdict" || bad "main rerun: exit $rc: $(cat "$W/out")"
# gh cannot read the push runs: not verified, never merged
new_world mainghfail 1
state 1
: >"$GHD/main-runs-fail"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qxF '#1 waits: the ci.yml push runs on main: gh exit 1: HTTP 502: Bad Gateway' "$W/out" && tail -n 1 "$W/out" | grep -qx 'LAND=unverified' \
    && ok "gh fails reading the push runs: waits, LAND=unverified, exit 3, not merged" || bad "main gh fail: exit $rc: $(cat "$W/out")"
# main turns red while land waits for the lock: read again under the lock, no merge
new_world mainlock 1
state 1
mkdir "$LAND_TEST_LOCK" "$GHD/on-sleep"; : >"$GHD/unlock-on-sleep"
red_main; mv "$GHD/main-runs" "$GHD/on-sleep/main-runs"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qxF "$RED_REASON" "$W/out" && [ ! -e "$LAND_TEST_LOCK" ] \
    && ok "red main: read again under the lock; turned red while land waited, no merge, the lock released" || bad "main lock: exit $rc: $(cat "$W/out")"
# a newer green run of a commit with documents only gives no verdict: main stays red, the culprit is the code PR below it
# (a project may run only its lint for documents). By the docs_only rule, and with no rule for a commit inside the tickets root.
for rule in docs_only tickets_root; do
    new_world "maindocsrun-$rule" 1
    state 1
    if [ "$rule" = docs_only ]; then edit 's.docs_only=process.env.DOCS_ONLY'; doc=notes/n.md; else doc=.scratch/e/issues/09.md; fi
    echo code >"$W/seed/code.txt" && git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m code
    code_sha="$(git -C "$W/seed" rev-parse HEAD)"
    mkdir -p "$W/seed/$(dirname "$doc")" && echo note >"$W/seed/$doc" && git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m docs && git -C "$W/seed" push -q origin main
    docs_sha="$(git -C "$W/seed" rev-parse HEAD)"
    main_runs "$(mrun 3 "$docs_sha" completed success 1 2026-11-09T10:20:00Z 2026-11-09T10:23:00Z)" "$(mrun 2 "$code_sha" completed failure 1 2026-11-09T10:00:00Z 2026-11-09T10:30:00Z)" "$R1"
    printf '[{"number":41,"merge_commit_sha":"%s"}]' "$code_sha" >"$GHD/pulls-$code_sha"
    "$LAND" "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qxF "main red since $(echo "$code_sha" | cut -c1-8) (#41, 2026-11-09T10:30:00Z) — code PRs wait; fix forward until 2026-11-09T11:30:00Z, then revert #41" "$W/out" \
        && grep -q "push run 3 on $(echo "$docs_sha" | cut -c1-8) (success): documents only, no verdict on the code" "$W/state.log" \
        && ok "red main ($rule): a newer green run of a documents-only commit gives no verdict, the code PR below it is the culprit" || bad "docs run over red ($rule): exit $rc: $(cat "$W/out")"
done
# timed_out is red; a commit whose PRs include none merged as it names the commit, not another PR
new_world maintimeout 1
state 1
main_runs "$(mrun 2 "$C2" completed timed_out 1 2026-11-09T10:00:00Z 2026-11-09T10:30:00Z)" "$R1"
printf '[{"number":40,"merge_commit_sha":"%s"}]' "$C1" >"$GHD/pulls-$C2"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qxF 'main red since 22222222 (no PR, 2026-11-09T10:30:00Z) — code PRs wait; fix forward until 2026-11-09T11:30:00Z, then revert 22222222' "$W/out" \
    && ok "red main: timed_out is red; a PR that did not merge the commit is not its culprit" || bad "timed_out: exit $rc: $(cat "$W/out")"
# no green run in the window of 50: the culprit is older, found by hand; fewer runs than the window are the whole history
new_world mainwindow 1
state 1
runs=(); for n in $(seq 51 -1 1); do runs+=("$(mrun "$n" "$C2" completed failure 1 "2026-11-09T$(printf '%02d' $((n / 4))):$(printf '%02d' $((n % 4 * 10))):00Z")"); done
main_runs "${runs[@]}"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -qxF 'main red since before 22222222 (no green push run among the newest 50, the oldest red one 2026-11-09T00:20:00Z) — code PRs wait; the culprit is older than these runs: find it by hand' "$W/out" \
    && ! grep -q '/pulls' "$GHD/log" && ok "red main: no green run among the newest 50 — the culprit is beyond the window, no revert named" || bad "window: exit $rc: $(cat "$W/out")"
new_world mainhistory 1
state 1
main_runs "$(mrun 3 "$C3" completed failure 1 2026-11-09T10:10:00Z)" "$(mrun 2 "$C2" completed failure 1 2026-11-09T10:00:00Z 2026-11-09T10:30:00Z)"
printf '[{"number":41,"merge_commit_sha":"%s"}]' "$C2" >"$GHD/pulls-$C2"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && grep -qxF "$RED_LINE" "$W/out" && ok "red main: fewer runs than the window and none green — the oldest red one is the culprit" || bad "history: exit $rc: $(cat "$W/out")"
# the input: main_fix is a boolean, docs_only null or a command, red_elsewhere null or {label, needs}, both text
for bad_input in 's.prs[0].main_fix="yes"' 's.docs_only=""' 's.docs_only=3' 's.red_elsewhere="pc-main-red"' 's.red_elsewhere={label:"pc-main-red"}' 's.red_elsewhere={label:"",needs:"x"}'; do
    i=$((i + 1)); new_world "input$i" 1
    state 1
    edit "$bad_input"
    "$LAND" "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" = 1 ] && [ ! -s "$GHD/log" ] && ok "input: $bad_input is refused before any gh call" || bad "input $bad_input: exit $rc: $(cat "$W/out")"
done

# --- the state-file block of skill epic-wave ("Merge with land") writes a file land takes -------------------------
SKILL="${SKILL_FILE:-$HERE/../../skills/epic-wave/SKILL.md}"
awk '/^\*\*Merge with land\*\*/{s=1} s && /<<.NODE.$/{n=1; next} n && /^NODE$/{exit} n' "$SKILL" >"$T/skill-state.js"
new_world skill 1
node "$T/skill-state.js" "$(tn "$S")" "$(tn "$W/repo")" main pr ci-ok ci.yml "node \"$(tn "$STUBS/docs-check.mjs")\"" ".scratch/" full "$DOCS_ONLY" pc-main-red "$NEEDS" "1:e:01:$(head_of 1):windows:main-fix" >"$W/out" 2>&1
echo '{"review":"success","check/windows":"success"}' >"$GHD/status-$(head_of 1).json"
"$LAND" "$S" >>"$W/out" 2>&1; rc=$?
[ -s "$T/skill-state.js" ] && [ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && [ "$(q "$S" 's.prs[0].head')" = "$(head_of 1)" ] && [ "$(q "$S" 's.prs[0].checks')" = '["windows"]' ] \
    && [ "$(q "$S" 's.tickets_root')" = .scratch ] && [ "$(q "$S" '"scope" in s')" = false ] && [ "$(q "$S" 's.docs_only')" = "$DOCS_ONLY" ] && [ "$(q "$S" 's.prs[0].main_fix')" = true ] \
    && [ "$(q "$S" 's.red_elsewhere.label')" = pc-main-red ] && [ "$(q "$S" 's.red_elsewhere.needs')" = "$NEEDS" ] \
    && ok "skill: the state file of the epic-wave block is one land merges from, with docs_only, red_elsewhere and main_fix" || bad "skill block: exit $rc: $(cat "$W/out")"
# the tickets root: an absolute one inside the repository becomes relative, one outside it and Silent mode give null; no Check — []
skill_root() { node "$T/skill-state.js" "$(tn "$W/s-$1.json")" "$(tn "$W/repo")" main pr ci-ok ci.yml "" "$2" "$3" "" "" "" "1:e:01:$(head_of 1):" >/dev/null 2>&1 && q "$W/s-$1.json" 's.tickets_root'; }
[ "$(skill_root abs "$(tn "$W/repo")/work/tickets/" full)" = work/tickets ] && [ "$(skill_root out "$(tn "$T")/elsewhere/" full)" = null ] \
    && [ "$(skill_root silent .scratch/ silent)" = null ] && [ "$(skill_root dot ./ full)" = null ] && [ "$(skill_root repo "$(tn "$W/repo")/" full)" = null ] && [ "$(skill_root none "" full)" = .scratch ] && [ "$(q "$W/s-none.json" 's.prs[0].checks')" = '[]' ] && [ "$(q "$W/s-none.json" 's.docs_only')" = null ] && [ "$(q "$W/s-none.json" '"main_fix" in s.prs[0]')" = false ] && [ "$(q "$W/s-none.json" 's.red_elsewhere')" = null ] \
    && ok "skill: tickets_root from the profile — absolute made relative, outside the repository, the repository itself or Silent mode null" || bad "skill roots: abs $(q "$W/s-abs.json" 's.tickets_root') out $(q "$W/s-out.json" 's.tickets_root') silent $(q "$W/s-silent.json" 's.tickets_root') dot $(q "$W/s-dot.json" 's.tickets_root') repo $(q "$W/s-repo.json" 's.tickets_root') none $(q "$W/s-none.json" 's.tickets_root')"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
