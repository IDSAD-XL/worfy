#!/usr/bin/env bash
# Tests of harness/bin/land and the Code story of a ticket's PR: the guard (code_stories.pr on: a ticket's PR merges
# only with its story read from the head and green by the real story-check; off, no ticket or no profile — no story
# needed), and the review step the documents PR appends to a story from prs[].verdict (the verdict quoted, the lines
# of the merged head it names, story-check green against that head and the anchor unchanged; nothing without a story
# or a verdict; evidence-check before the commit; a rebase; Silent mode). The world is land.test.sh's (land-world.sh):
# a bare origin with PR refs, a clone as the orchestrator's checkout, node stubs for gh, ticket and the rest. gh is
# always the stub: no network, no real gh, no credential. Split from land.test.sh by theme, so each file stays inside
# the per-file time limit of test/harness-scripts-suite.ts on a loaded machine.
# Run: bash harness/bin/tests/land-story.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/land-world.sh"

# --- the Code story guard: with code_stories.pr on, a ticket's PR merges only with its story, green on the head ----------
# The story is read from the PR's head commit, never from the checkout's working tree, and checked by the real
# story-check against that head (bin/TICKETS.md, "Story anchor"); the fixtures are the shared ones of the format.
FIX="$HERE/fixtures/code-story"
STORY_PATH=".scratch/demo-cart/stories/04-cart-total.md"
# story_world <name> [<story fixture>]: PR 1's head gets the code of the fixtures and, when named, the story at STORY_PATH;
# the state file names the PR's ticket demo-cart 04; code_stories.pr is on.
story_world() {
    new_world "$1" 1
    git -C "$W/seed" fetch -q origin refs/pull/1/head && git -C "$W/seed" checkout -q --detach FETCH_HEAD
    cp -R "$FIX/repo/src" "$W/seed/src"
    if [ -n "${2:-}" ]; then mkdir -p "$W/seed/.scratch/demo-cart/stories" && cp "$FIX/$2" "$W/seed/$STORY_PATH"; fi
    git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m "pr 1 code" && git -C "$W/seed" push -q -f origin HEAD:refs/pull/1/head
    git -C "$W/seed" checkout -q main
    state 1
    edit 's.prs[0].epic="demo-cart";s.prs[0].ticket="04"'
    echo on >"$GHD/code-stories"
}
story_world sg-green pr-en.md
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && grep -q "story-check .* $STORY_PATH — exit 0" "$W/state.log" && grep -qx ".* $STORY_PATH: ok" "$W/state.log" \
    && ok "story guard: on, the story green on the head -> merged (the checkout on main has no src/: the code is read from the head)" || bad "story guard green: exit $rc: $(cat "$W/out") log $(grep -i story "$W/state.log")"
grep -qx -- "-C $(tn "$W/repo") --field code_stories.pr" "$GHD/profile.log" \
    && ok "story guard: the switch is the profile's code_stories.pr of the checkout" || bad "story guard: profile calls $(cat "$GHD/profile.log")"
[ "$(grep -c 'story-check --repo' "$W/state.log")" = 1 ] \
    && ok "story guard: a story green at a head is not checked again under the main-branch lock" || bad "story guard cache: $(grep -c 'story-check --repo' "$W/state.log") story-check runs"
# Silent mode (tickets_root null): the story is in the folder `ticket root` prints, and the PR's head, never fetched into
# the checkout (only refs/pull/1/head of the origin has it), is fetched before story-check reads its code.
story_world sg-silent
edit 's.tickets_root=null'
mkdir -p "$W/wf/demo-cart/stories" && cp "$FIX/pr-en.md" "$W/wf/demo-cart/stories/04-cart-total.md" && printf '%s\n' "$(tn "$W/wf")" >"$GHD/tickets-root"
! git -C "$W/repo" cat-file -e "$(head_of 1)^{commit}" 2>/dev/null && had=no || had=yes
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$had" = no ] && [ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && grep -q "story-check .*04-cart-total.md — exit 0" "$W/state.log" \
    && ok "story guard, tickets outside the repository: the head not in the checkout is fetched, the story of the folder green -> merged" || bad "story guard silent: had=$had exit $rc: $(cat "$W/out") log $(grep -i story "$W/state.log")"
story_world sg-none
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && [ "$(merged_of 1)" = 0 ] && grep -q "^#1 waits: no Code story of ticket demo-cart 04: .scratch/demo-cart/stories/04-<slug>.md is not in the head $(head_of 1 | cut -c1-8)" "$W/out" && tail -n 1 "$W/out" | grep -qx 'LAND=red' \
    && ok "story guard: on, no story in the head -> not merged, LAND=red, the reason names the path" || bad "story guard none: exit $rc: $(cat "$W/out")"
# a story in the checkout's working tree does not count: the guard reads the head only
mkdir -p "$W/repo/.scratch/demo-cart/stories" && cp "$FIX/pr-en.md" "$W/repo/$STORY_PATH" && cp -R "$FIX/repo/src" "$W/repo/src"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && [ "$(merged_of 1)" = 0 ] && grep -q '^#1 waits: no Code story' "$W/out" \
    && ok "story guard: a story in the checkout's working tree but not in the head -> still not merged" || bad "story guard worktree: exit $rc: $(cat "$W/out")"
story_world sg-red bad-fragment.md
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && [ "$(merged_of 1)" = 0 ] && grep -q "^#1 waits: story-check is red on $STORY_PATH at $(head_of 1 | cut -c1-8): $STORY_PATH:2: .*src/cart.ts:10-17" "$W/out" \
    && ok "story guard: on, story-check red -> not merged, LAND=red, the first problem named with the story's path" || bad "story guard red: exit $rc: $(cat "$W/out")"
story_world sg-off
echo off >"$GHD/code-stories"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && ok "story guard: code_stories.pr off -> merged without a story" || bad "story guard off: exit $rc: $(cat "$W/out")"
story_world sg-noticket
edit 'delete s.prs[0].epic;delete s.prs[0].ticket'
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && [ ! -e "$GHD/profile.log" ] && ! grep -qi "story" "$W/state.log" \
    && ok "story guard: a PR without a ticket -> merged, the guard does not read the profile or look for a story" || bad "story guard no ticket: exit $rc: $(cat "$W/out")"
story_world sg-unread pr-en.md
echo 1 >"$GHD/profile-rc"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merged_of 1)" = 0 ] && grep -q '^#1 waits: code_stories.pr could not be read: bin/profile exit 1' "$W/out" \
    && ok "story guard: the profile cannot be read (exit 1) -> waits, never merges" || bad "story guard unread: exit $rc: $(cat "$W/out")"
story_world sg-unregistered
echo 3 >"$GHD/profile-rc"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && grep -q 'no profile.*no Code story is required' "$W/state.log" \
    && ok "story guard: a project with no profile (exit 3) -> no story required, merged, the log says why" || bad "story guard unregistered: exit $rc: $(cat "$W/out")"

# --- the review step: the documents PR appends "What review found and what remains" to the story, from prs[].verdict ------
# The step quotes the saved verdict (the output of bin/verdict) and, for each `path:<line>` or `path:<from>-<to>` of it that
# the merged head holds, those lines of that head; the real story-check is green on the result against the same head
# (bin/TICKETS.md, "Story anchor", item 2). No model is called: the step is made of the verdict's own text.
# show_at <ref> <path>: the file at <ref>:<path> of the origin, read through node (see the evidence case above).
show_at() { node -e 'process.stdout.write(require("child_process").execFileSync("git", ["-C", process.argv[1], "show", `${process.argv[2]}:${process.argv[3]}`], { encoding: "utf8" }))' "$W/origin.git" "$1" "$2"; }
# verdict_of <line>…: the lines become the saved verdict $W/verdict.md, and the state file names it for PR 1
verdict_of() { printf '%s\n' "$@" >"$W/verdict.md"; edit "s.prs[0].verdict=$(node -p 'JSON.stringify(process.argv[1])' "$(tn "$W/verdict.md")")"; }
docs_files() { git -C "$W/origin.git" show --name-only --format= refs/pull/900/head | sort | tr '\n' ' '; }
# The verdict below has the shape of what epic-wave saves: the verifier's answer of the last round through bin/verdict —
# the verdict line, the findings, what it ran and what it could not verify (agents/reviewer.md, the answer format).
story_world rs-step pr-en.md
h1="$(head_of 1)"
verdict_of 'VERIFIED' \
    'src/cart.ts:13: [low] a line with a zero quantity is skipped silently — kept: the ticket allows it' \
    'ran: pnpm test test/unit/cart.test.ts — exit 0' \
    'could not verify: a price with three decimals (`src/money.ts:9-11`), `src/gone.ts:3`, base.txt:99'
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
doc="$(show_at refs/pull/900/head "$STORY_PATH" 2>&1)"
step="$(printf '%s\n' \
    '## 6. What review found and what remains' '' \
    '> VERIFIED' \
    '> src/cart.ts:13: [low] a line with a zero quantity is skipped silently — kept: the ticket allows it' \
    '> ran: pnpm test test/unit/cart.test.ts — exit 0' \
    '> could not verify: a price with three decimals (`src/money.ts:9-11`), `src/gone.ts:3`, base.txt:99' '' \
    'Code: `src/cart.ts:13-13` · key lines: 13' '' '```ts' '    if (line.quantity <= 0) continue' '```' '' \
    'Code: `src/money.ts:9-11` · key lines: 9' '' '```ts' '  const whole = Number(match[1])' \
    "  const part = Number((match[2] ?? '0').padEnd(2, '0'))" '  return whole * 100 + part' '```')"
[ "$rc" = 0 ] && [ "$doc" = "$(cat "$FIX/pr-en.md")"$'\n\n'"$step" ] \
    && ok "review step: verdict and story -> the documents PR appends the step last: the verdict quoted, a fragment per path:line the head holds" \
    || bad "review step: exit $rc: $(cat "$W/out") story: $(printf '%s' "$doc" | tail -n 25)"
[ "$(docs_files)" = ".scratch/demo-cart/issues/04.md $STORY_PATH " ] && ok "review step: the story is in the same documents commit as the ticket" || bad "review step: documents commit $(docs_files)"
printf '%s\n' "$doc" >"$W/story-after.md"
STORY_CHECK="$HERE/../story-check"
sc="$(node "$STORY_CHECK" --repo "$W/repo" --head "$h1" "$W/story-after.md" 2>&1)"; sc_rc=$?
[ "$sc_rc" = 0 ] && grep -q "4 fragments checked against $h1" <<<"$sc" && grep -q "story-check --head $h1 $STORY_PATH — exit 0" "$W/state.log" \
    && ok "review step: story-check is green on the appended story against the merged head, in land and again here" || bad "review step: story-check exit $sc_rc: $sc log $(grep -i story-check "$W/state.log")"
# the anchor stays the commit that added the story to the main branch, and story-check reads the same head three times:
# in the guard, on the story before the step and on the story after it
squash="$(q "$S" 's.prs[0].result.sha')"
added_by() { git -C "$W/origin.git" log --first-parent --follow --diff-filter=A --format=%H -1 "$1" -- "$STORY_PATH"; }
[ "$(added_by "$squash")" = "$squash" ] && [ "$(added_by refs/heads/main)" = "$squash" ] && [ "$(q "$S" 's.prs[0].result.head')" = "$h1" ] \
    && [ "$(grep -c "fragments checked against $h1 (--head $h1)" "$W/state.log")" = 3 ] \
    && ok "review step: after the append the story's anchor is the same squash commit, and story-check reads the same head before and after" \
    || bad "review step: anchor before $squash, after $(added_by refs/heads/main), head $(q "$S" 's.prs[0].result.head'), log $(grep 'checked against' "$W/state.log")"
# no story, or no verdict in the state file: the documents PR is what it was before the review step, byte for byte
story_world rs-nostory
echo off >"$GHD/code-stories"
verdict_of 'VERIFIED'
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(docs_files)" = ".scratch/demo-cart/issues/04.md " ] && ! grep -qi "review step\|story-check" "$W/state.log" \
    && ok "review step: a verdict but no story -> the documents PR has the ticket only, nothing said" || bad "review step no story: exit $rc: $(cat "$W/out") files $(docs_files)"
story_world rs-noverdict pr-en.md
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(docs_files)" = ".scratch/demo-cart/issues/04.md " ] && [ "$(show_at refs/pull/900/head "$STORY_PATH")" = "$(cat "$FIX/pr-en.md")" ] \
    && ok "review step: a story but no verdict -> the documents PR has the ticket only, the story byte for byte the PR's" || bad "review step no verdict: exit $rc: $(cat "$W/out") files $(docs_files)"
# personal data in the verdict: evidence-check is red before anything is committed, as with the Evidence lines
story_world rs-leak pr-en.md
leak="gh""p_$(printf 'Zq%.0s' $(seq 1 15))"
verdict_of 'VERIFIED' "ran: with token $leak — exit 0"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && [ "$(merged_of 1)" = 1 ] && ! grep -q '^pr create\|^pr list' "$GHD/log" && [ -z "$(git -C "$W/origin.git" for-each-ref 'refs/heads/land-docs/*')" ] \
    && grep -q '^documents land-docs/.* waits: evidence-check found 1 findings' "$W/out" && ! grep -qF "$leak" "$W/out" "$S" "$W/state.log" \
    && ok "review step: personal data in the verdict -> evidence-check red, nothing committed or pushed, the value printed nowhere" || bad "review step leak: exit $rc: $(cat "$W/out")"
# an unreadable verdict: the documents wait, nothing pushed
story_world rs-unread pr-en.md
edit "s.prs[0].verdict=$(node -p 'JSON.stringify(process.argv[1])' "$(tn "$W/no-such-verdict.md")")"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ -z "$(git -C "$W/origin.git" for-each-ref 'refs/heads/land-docs/*')" ] && grep -q '^documents land-docs/.* waits: the verdict of #1 cannot be read' "$W/out" \
    && ok "review step: the verdict file cannot be read -> the documents wait, nothing pushed" || bad "review step unread: exit $rc: $(cat "$W/out")"
# a relative verdict path is an input error
story_world rs-relative pr-en.md
edit 's.prs[0].verdict="verdict.md"'
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 1 ] && grep -q '"verdict" must be the absolute path of the saved verdict' "$W/out" && [ "$(merges)" = 0 ] \
    && ok "review step: a relative verdict path -> exit 1, nothing merged" || bad "review step relative: exit $rc: $(cat "$W/out")"
# a rebase after the review: the fragments quote the merged head where the reviewed lines stand now; a line the rebase
# changed is not quoted (the review never saw it)
story_world rs-rebase pr-en.md
h1="$(head_of 1)"
{ printf 'a\nb\n'; seq 1 40 | sed 's/^10$/ten/'; } >"$W/seed/base.txt" && git -C "$W/seed" commit -q -am "main moves" && git -C "$W/seed" push -q origin main
git -C "$W/seed" fetch -q origin refs/pull/1/head && git -C "$W/seed" checkout -q --detach FETCH_HEAD && git -C "$W/seed" rebase -q main \
    && git -C "$W/seed" push -q -f origin HEAD:refs/pull/1/head && git -C "$W/seed" checkout -q main
h2="$(head_of 1)"
edit "s.prs[0].head='$h1'"
verdict_of 'VERIFIED' 'base.txt:5-6: [low] two lines the rebase moved' 'base.txt:10: [low] a line the rebase changed'
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
doc="$(show_at refs/pull/900/head "$STORY_PATH" 2>&1)"
want="$(printf '%s\n' 'Code: `base.txt:7-8` · key lines: 7' '' '```txt' 5 6 '```')"
[ "$rc" = 0 ] && [ "$h1" != "$h2" ] && [ "$(q "$S" 's.prs[0].result.head')" = "$h2" ] && [[ "$doc" == *"$want" ]] && [ "$(grep -c '^Code: `base.txt' <<<"$doc")" = 1 ] \
    && grep -q "story-check --head $h2 $STORY_PATH — exit 0" "$W/state.log" \
    && ok "review step: after a rebase the reviewed lines are quoted where the merged head has them, a changed line not at all" \
    || bad "review step rebase: exit $rc h1 $h1 h2 $h2: $(cat "$W/out") story: $(printf '%s' "$doc" | tail -n 12)"
# pr_add <path> <text>: one more commit on PR 1's head, with <path> holding <text>
pr_add() {
    git -C "$W/seed" fetch -q origin refs/pull/1/head && git -C "$W/seed" checkout -q --detach FETCH_HEAD
    mkdir -p "$(dirname "$W/seed/$1")" && printf '%s\n' "$2" >"$W/seed/$1"
    git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m "pr 1 more" && git -C "$W/seed" push -q -f origin HEAD:refs/pull/1/head
    git -C "$W/seed" checkout -q main
}
# a line the verdict names that trips the privacy check (a UUID, made here so no file of the repository holds one) is
# not quoted, and the documents PR goes on: the repository's own code may hold such lines
story_world rs-private pr-en.md
uuid="$(node -p 'require("crypto").randomUUID()')"
pr_add src/ids.ts "export const SESSION = '$uuid'"
verdict_of 'VERIFIED' 'src/ids.ts:1: [low] a session id in the code' 'src/cart.ts:13: [low] a zero quantity is skipped'
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
doc="$(show_at refs/pull/900/head "$STORY_PATH" 2>&1)"
[ "$rc" = 0 ] && [[ "$doc" == *'Code: `src/cart.ts:13-13`'* ]] && ! grep -q '^Code: `src/ids.ts' <<<"$doc" && ! grep -qF "$uuid" <<<"$doc" \
    && grep -q 'src/ids.ts:1-1 is not quoted: personal data (uuid)' "$W/state.log" && ! grep -qF "$uuid" "$W/out" "$S" "$W/state.log" \
    && ok "review step: a named line with personal data is not quoted, the log says so without the value, the documents PR merges" \
    || bad "review step private: exit $rc: $(cat "$W/out") log $(grep -i 'not quoted' "$W/state.log") story: $(printf '%s' "$doc" | tail -n 12)"
# a story already red at its head (code_stories.pr off, so the guard never read it): no step for it, the documents PR goes on
story_world rs-redstory bad-fragment.md
echo off >"$GHD/code-stories"
verdict_of 'VERIFIED' 'src/cart.ts:13: [low] a zero quantity is skipped'
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && tail -n 1 "$W/out" | grep -qx 'LAND=green' && [ "$(docs_files)" = ".scratch/demo-cart/issues/04.md " ] \
    && [ "$(show_at refs/pull/900/head "$STORY_PATH")" = "$(cat "$FIX/bad-fragment.md")" ] && grep -q "is red at $(head_of 1 | cut -c1-8) already, no review step appended" "$W/state.log" \
    && ok "review step: a story red at its head before the step -> nothing appended, the log says why, the documents PR merges" \
    || bad "review step red story: exit $rc: $(cat "$W/out") files $(docs_files) log $(grep -i 'review step\|red at' "$W/state.log")"
# the head review verified is gone (a force-push after a merge by hand): the step quotes the verdict but no code
story_world rs-gone pr-en.md
verdict_of 'VERIFIED' 'src/cart.ts:13: [low] a zero quantity is skipped'
echo 1 >"$GHD/docs-check-rc"
"$LAND" "$S" >/dev/null 2>&1
rm -f "$GHD/docs-check-rc"
edit "s.prs[0].head='$(printf 'ab%.0s' $(seq 1 20))'"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
doc="$(show_at refs/pull/900/head "$STORY_PATH" 2>&1)"
after="$(awk '/^## 6\. What review found and what remains$/{s=1} s' <<<"$doc")"
[ "$rc" = 0 ] && [ -n "$after" ] && grep -q '^> src/cart.ts:13: ' <<<"$after" && ! grep -q '^Code: ' <<<"$after" \
    && grep -q "the head abababab review verified is not in the checkout: no fragment quoted" "$W/state.log" \
    && ok "review step: the reviewed head cannot be read -> the verdict quoted, no fragment of another head" \
    || bad "review step gone head: exit $rc: $(cat "$W/out") step: $after"
# a saved verdict with no verdict line: the documents wait, nothing pushed
story_world rs-noline pr-en.md
verdict_of 'Checked the diff, nothing to add.'
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ -z "$(git -C "$W/origin.git" for-each-ref 'refs/heads/land-docs/*')" ] && grep -q '^documents land-docs/.* waits: the verdict of #1 (.*) has no line that starts with VERIFIED or REJECTED' "$W/out" \
    && ok "review step: a verdict file without a verdict line -> the documents wait, nothing pushed" || bad "review step no line: exit $rc: $(cat "$W/out")"
# a story in Russian: its own title of the step; a story that has the step already gets no second one
RU_PATH=".scratch/demo-cart/stories/05-coupons.md"
# ru_world <name> <story file>: story_world for the Russian fixture's ticket demo-cart 05, the story at RU_PATH
ru_world() {
    new_world "$1" 1
    git -C "$W/seed" fetch -q origin refs/pull/1/head && git -C "$W/seed" checkout -q --detach FETCH_HEAD
    cp -R "$FIX/repo/src" "$W/seed/src" && mkdir -p "$W/seed/.scratch/demo-cart/stories" && cp "$2" "$W/seed/$RU_PATH"
    git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m "pr 1 code" && git -C "$W/seed" push -q -f origin HEAD:refs/pull/1/head
    git -C "$W/seed" checkout -q main
    state 1
    edit 's.prs[0].epic="demo-cart";s.prs[0].ticket="05"'
    echo on >"$GHD/code-stories"
}
ru_world rs-ru-has "$FIX/pr-ru.md"
verdict_of 'Read the diff and the story.' '**VERIFIED**' 'ran: pnpm test — exit 0'
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(docs_files)" = ".scratch/demo-cart/issues/05.md " ] && grep -q "$RU_PATH has the step \"Что нашёл review и что осталось\" already, nothing appended" "$W/state.log" \
    && ok "review step: a Russian story that has its step already -> nothing appended" || bad "review step ru has: exit $rc: $(cat "$W/out") files $(docs_files)"
sed '/^## 5\. Что нашёл review/,$d' "$FIX/pr-ru.md" >"$T/ru-no-step.md"
ru_world rs-ru-add "$T/ru-no-step.md"
verdict_of 'Read the diff and the story.' '**VERIFIED**' 'ran: pnpm test — exit 0'
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
doc="$(show_at refs/pull/900/head "$RU_PATH" 2>&1)"
[ "$rc" = 0 ] && [ "$doc" = "$(cat "$T/ru-no-step.md")"$'\n\n'"$(printf '%s\n' '## 5. Что нашёл review и что осталось' '' '> VERIFIED' '> ran: pnpm test — exit 0')" ] \
    && ok "review step: a Russian story gets the Russian title; the verdict quoted from its line on, the lead-in and the markup dropped" \
    || bad "review step ru add: exit $rc: $(cat "$W/out") story: $(printf '%s' "$doc" | tail -n 6)"
# Silent mode: no documents PR, so the step is the orchestrator's; land says so
new_world rs-silent 1
state 1
edit "s.tickets_root=null"
verdict_of 'VERIFIED'
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && grep -qx "review step of #1 is the orchestrator's (tickets outside the repository)" "$W/out" \
    && ok "review step: tickets_root null -> no documents PR, the line 'review step of #1 is the orchestrator's'" || bad "review step silent: exit $rc: $(cat "$W/out")"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
