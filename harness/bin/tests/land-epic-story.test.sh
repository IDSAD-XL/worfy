#!/usr/bin/env bash
# Tests of harness/bin/land and the story of an epic (bin/TICKETS.md, "Code story", "Ticket with code"):
#   - `land <state> --epic-story` tells, before any merge, whether the state file holds the epic's last PR with code:
#     every other ticket with code of the epic is done on the main branch, and an owner's acceptance (`Who: owner`,
#     or its Russian word in lib/input-words.json) does not count, open or not;
#   - prs[].files: the extra files of the documents PR (a path in the tickets root and the absolute path of the ready
#     file), put into the same documents PR as the ticket's `Status: done`, before the privacy check (evidence-check
#     red — the documents wait, nothing committed or pushed); without the field the documents PR is what it was; a
#     run broken off and run again puts the file once; a file the main branch already has is not written again;
#   - Silent mode (tickets_root null): no documents PR, the file goes into the tickets folder outside the repository.
# The world is land.test.sh's (land-world.sh): a bare origin with PR refs, a clone as the orchestrator's checkout, node
# stubs for gh, ticket and the rest; evidence-check and epic-status are the real ones. gh is always the stub: no
# network, no real gh, no credential. A file of its own, so each file stays inside the per-file time limit of
# test/harness-scripts-suite.ts.
# Run: bash harness/bin/tests/land-epic-story.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/land-world.sh"

docs_files() { git -C "$W/origin.git" show --name-only --format= refs/pull/900/head | sort | tr '\n' ' '; }
show_at() { node -e 'process.stdout.write(require("child_process").execFileSync("git", ["-C", process.argv[1], "show", `${process.argv[2]}:${process.argv[3]}`], { encoding: "utf8" }))' "$W/origin.git" "$1" "$2"; }
# on_main <path> <text>…: a commit on the origin's main branch adds <path> with the lines <text>…
on_main() {
    local p="$1"; shift
    git -C "$W/seed" checkout -q main && git -C "$W/seed" pull -q --ff-only origin main 2>/dev/null
    mkdir -p "$(dirname "$W/seed/$p")" && printf '%s\n' "$@" >"$W/seed/$p"
    git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m "add $p" && git -C "$W/seed" push -q origin main
}
# ticket_on_main <NN-slug> <status> [<header line>]: the ticket .scratch/e/issues/<NN-slug>.md on the main branch
ticket_on_main() { on_main ".scratch/e/issues/$1.md" "# $1" "" "Type: task" "Status: $2" "${3:-Blocked by: —}" "" "## What happens" "" "Text."; }
# with_story <N> <file>: PR N of the state file carries <file> as the extra file e/story.md of the documents PR
with_story() { edit "s.prs.find((p) => p.number === $1).files = [{ path: 'e/story.md', from: $(node -p 'JSON.stringify(process.argv[1])' "$(tn "$2")") }]"; }
shape=0
EPIC_STORY="$(printf '%s\n' '# Code story — e' '' 'Kind: epic · Epic: e · Language: en' '' '## Start' '' 'What the epic set out to fix.')"

# --- the trigger: the last PR of the epic with code, known before land merges anything ----------------------------------
new_world es-trigger 2
ticket_on_main 01-done "done 2026-11-16T10:00Z"
ticket_on_main 02-code open 'Кто: агент.'
ticket_on_main 03-acceptance open 'Кто: владелец, с Orchestrator-ом. Autopilot этот Ticket не берёт.'
ticket_on_main 04-owner-check claimed 'Who: owner'
state 2
cp "$S" "$W/state-before.json"
out="$("$LAND" "$S" --epic-story 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$out" = "epic story of e is due: #2 (e 02) is its last PR with code" ] \
    && ok "trigger: the owner's acceptance tickets are open, every other ticket with code is done -> the state file's PR is the last with code" \
    || bad "trigger: exit $rc: $out"
[ "$(merges)" = 0 ] && ! grep -q '^pr ' "$GHD/log" 2>/dev/null && cmp -s "$S" "$W/state-before.json" \
    && ok "trigger: --epic-story merges nothing, asks gh nothing and leaves the state file as it was" || bad "trigger: gh $(cat "$GHD/log" 2>/dev/null) state $(cat "$S")"
# one more ticket with code still open (no Who line at all counts as code): not the last
ticket_on_main 05-more open
out="$("$LAND" "$S" --epic-story 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$out" = "epic story of e is not due: tickets with code still open: 05" ] \
    && ok "trigger: another ticket with code is open -> not due, the line names it" || bad "trigger not due: exit $rc: $out"
# The header rule: Who only as a word of its own at the start of the value, outside code blocks, before the first `## `
# heading after the Status line. Each case: ticket 02 is the state file's, ticket 06 has the header below; 06 has code.
# header_case <name> <line>…: the lines are ticket 06 on the main branch; 06 must count as a ticket with code
header_case() {
    local name="$1"; shift
    new_world "es-header-$name" 2
    ticket_on_main 02-code open
    on_main .scratch/e/issues/06-case.md "$@"
    state 2
    out="$("$LAND" "$S" --epic-story 2>&1)"; rc=$?
    [ "$rc" = 0 ] && [ "$out" = "epic story of e is not due: tickets with code still open: 06" ] \
        && ok "trigger, header rule: $name -> ticket 06 has code" || bad "trigger, header rule $name: exit $rc: $out"
}
header_case "a word that only starts with owner" '# 06' '' 'Status: open' 'Who: owners of the cart' '' '## What happens'
header_case "Who: owner inside a code block of the header" '# 06' '' 'Status: open' '```text' 'Who: owner' '```' '' '## What happens'
header_case "Who: owner after the first ## heading" '# 06' '' 'Status: open' '' '## What happens' '' 'Who: owner'
# two PRs of the epic in one state file: the last in merge order is the last with code
new_world es-trigger-two 2 3
ticket_on_main 02-code open
ticket_on_main 03-code claimed
ticket_on_main 04-acceptance open 'Кто: владелец.'
state 3 2
out="$("$LAND" "$S" --epic-story 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$out" = "epic story of e is due: #2 (e 02) is its last PR with code" ] \
    && ok "trigger: both open tickets with code are in the state file -> the last PR in merge order is the last with code" || bad "trigger two: exit $rc: $out"
# the tickets are read on the main branch of the origin, not in the checkout's working tree
new_world es-trigger-tree 2
ticket_on_main 02-code open
ticket_on_main 05-more open
mkdir -p "$W/repo/.scratch/e/issues" && printf '# 05\n\nStatus: done\n' >"$W/repo/.scratch/e/issues/05-more.md"
state 2
out="$("$LAND" "$S" --epic-story 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$out" = "epic story of e is not due: tickets with code still open: 05" ] \
    && ok "trigger: a ticket done only in the checkout's working tree still counts as open (the main branch of the origin is read)" || bad "trigger tree: exit $rc: $out"
# Silent mode: the tickets of the folder `ticket root` prints
new_world es-trigger-silent 2
state 2
edit 's.tickets_root=null'
mkdir -p "$W/wf/e/issues"
printf '# 02\n\nStatus: open\n' >"$W/wf/e/issues/02-code.md"
printf '# 03\n\nStatus: open\nWho: owner, with the orchestrator\n' >"$W/wf/e/issues/03-acceptance.md"
printf '%s\n' "$(tn "$W/wf")" >"$GHD/tickets-root"
out="$("$LAND" "$S" --epic-story 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$out" = "epic story of e is due: #2 (e 02) is its last PR with code" ] \
    && ok "trigger, tickets outside the repository: the folder of 'ticket root' is read" || bad "trigger silent: exit $rc: $out"

# --- prs[].files: the epic's story rides in the documents PR -------------------------------------------------------------
new_world es-docs 1
state 1
printf '%s\n' "$EPIC_STORY" >"$W/story.md"
with_story 1 "$W/story.md"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && tail -n 1 "$W/out" | grep -qx 'LAND=green' && [ "$(docs_files)" = ".scratch/e/issues/01.md .scratch/e/story.md " ] \
    && [ "$(show_at refs/pull/900/head .scratch/e/story.md)" = "$EPIC_STORY" ] && [ "$(show_at refs/pull/900/head .scratch/e/issues/01.md)" = "$(printf 'Status: done\nPR: #1')" ] \
    && ok "files: the documents PR carries <epic>/story.md byte for byte next to the last ticket's Status: done, in one commit" \
    || bad "files: exit $rc: $(cat "$W/out") files $(docs_files)"
grep -q "e/story.md of #1 written into the documents" "$W/state.log" && ok "files: the log names the file" || bad "files: log $(grep -i story "$W/state.log")"
# personal data in the story: the real evidence-check is red, nothing committed or pushed
new_world es-leak 1
state 1
printf '%s\n' "$EPIC_STORY" "ran: cd /""Users/qzuser/w && pnpm test" >"$W/story.md"
with_story 1 "$W/story.md"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && tail -n 1 "$W/out" | grep -qx 'LAND=red' && grep -q '^documents land-docs/.* waits: evidence-check found 1 finding' "$W/out" \
    && [ -z "$(git -C "$W/origin.git" for-each-ref 'refs/heads/land-docs/*')" ] && ! grep -q '^pr create' "$GHD/log" \
    && ! git -C "$W/origin.git" cat-file -e "main:.scratch/e/issues/01.md" 2>/dev/null && ! grep -q "qzuser" "$W/out" "$W/state.log" \
    && ok "files: a story with personal data -> evidence-check red, the documents wait, nothing committed or pushed, the value nowhere" \
    || bad "files leak: exit $rc: $(cat "$W/out") log $(grep -i evidence "$W/state.log")"
# without the field: the documents PR is what it was before the field, byte for byte (the ticket's file alone, the same
# commit message, title and body)
new_world es-nofield 1
state 1
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(git -C "$W/origin.git" diff --name-status refs/pull/900/head^ refs/pull/900/head | tr '\t' ' ')" = "A .scratch/e/issues/01.md" ] \
    && [ "$(show_at refs/pull/900/head .scratch/e/issues/01.md)" = "$(printf 'Status: done\nPR: #1')" ] \
    && [ "$(git -C "$W/origin.git" log -1 --format=%B refs/pull/900/head)" = "docs: mark the tickets of #1 done" ] \
    && grep -qx "pr create --base main --head land-docs/[0-9T]* --title docs: mark the tickets of #1 done --body The tickets of #1, merged by land, are marked done." "$GHD/log" \
    && ! grep -q "written into" "$W/state.log" \
    && ok "files: no field -> the documents PR has the ticket's file alone, the same message, title and body" \
    || bad "files none: exit $rc: $(cat "$W/out") diff $(git -C "$W/origin.git" diff --name-status refs/pull/900/head^ refs/pull/900/head) gh $(grep 'pr create' "$GHD/log")"
# a run broken off before the documents PR is recorded (killed at `gh pr create`, so d.pr is not saved), run again on the
# same state file: the documents branch is made again from the main branch, and the story is put once
new_world es-rerun 1
state 1
printf '%s\n' "$EPIC_STORY" >"$W/story.md"
with_story 1 "$W/story.md"
touch "$GHD/kill-before-create"
"$LAND" "$S" >"$W/out1" 2>&1; rc1=$?
rm -f "$GHD/kill-before-create"
saved="$(q "$S" 's.docs[0].pr')"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
adds="$(git -C "$W/origin.git" log --format=%H --diff-filter=A main -- .scratch/e/story.md | wc -l | tr -d ' ')"
touches="$(git -C "$W/origin.git" log --format=%H main -- .scratch/e/story.md | wc -l | tr -d ' ')"
[ "$rc1" != 0 ] && [ "$saved" = null ] && [ "$rc" = 0 ] && tail -n 1 "$W/out" | grep -qx 'LAND=green' && [ "$adds" = 1 ] && [ "$touches" = 1 ] \
    && [ "$(grep -c '^pr create' "$GHD/log")" = 2 ] && [ "$(grep -c '^pr merge 900 ' "$GHD/log")" = 1 ] && [ "$(show_at main .scratch/e/story.md)" = "$EPIC_STORY" ] \
    && ok "files: a run killed before the documents PR was saved, run again -> one documents PR merged, story.md added once" \
    || bad "files rerun: exit $rc1/$rc pr $saved adds $adds touches $touches creates $(grep -c '^pr create' "$GHD/log"): $(cat "$W/out")"
# the main branch has the same story already (an earlier documents PR put it): nothing to write, the documents PR has the
# ticket alone
new_world es-exists 1
on_main .scratch/e/story.md "$EPIC_STORY"
state 1
printf '%s\n' "$EPIC_STORY" >"$W/story.md"
with_story 1 "$W/story.md"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(docs_files)" = ".scratch/e/issues/01.md " ] && grep -q "e/story.md of #1 is in main already, the same bytes: not written again" "$W/state.log" \
    && ok "files: the main branch has the same file -> not written again, the log says so" || bad "files exists: exit $rc: $(cat "$W/out") files $(docs_files)"
# a different story on the main branch (a ticket with code added to the epic after its story): never overwritten, the
# documents wait red, nothing pushed
new_world es-differs 1
on_main .scratch/e/story.md "$EPIC_STORY"
state 1
printf '%s\n' "$EPIC_STORY" "A second version." >"$W/story.md"
with_story 1 "$W/story.md"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && tail -n 1 "$W/out" | grep -qx 'LAND=red' && grep -q '^documents land-docs/.* waits: e/story.md of #1 differs from the one in main' "$W/out" \
    && [ -z "$(git -C "$W/origin.git" for-each-ref 'refs/heads/land-docs/*')" ] && [ "$(show_at main .scratch/e/story.md)" = "$EPIC_STORY" ] \
    && ok "files: a different file on the main branch -> not overwritten, the documents wait red, nothing pushed" || bad "files differs: exit $rc: $(cat "$W/out")"
# a symbolic link committed at the path (here a broken one, pointing out of the repository): nothing is written through it
new_world es-link 1
mkdir -p "$W/seed/.scratch/e" && ln -s "$W/outside/story.md" "$W/seed/.scratch/e/story.md" \
    && git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m link && git -C "$W/seed" push -q origin main
state 1
printf '%s\n' "$EPIC_STORY" >"$W/story.md"
with_story 1 "$W/story.md"
mkdir -p "$W/outside"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && grep -q '^documents land-docs/.* waits: e/story.md of #1: ' "$W/out" && [ ! -e "$W/outside/story.md" ] && [ -z "$(git -C "$W/origin.git" for-each-ref 'refs/heads/land-docs/*')" ] \
    && ok "files: a symbolic link at the path -> nothing written through it, the documents wait red" || bad "files link: exit $rc: $(cat "$W/out") outside $(ls "$W/outside")"
# an earlier PR of the same epic waits in this run: the story would tell of a PR that is not merged, so the documents wait;
# once that PR merges, the next run puts the story with both tickets
new_world es-order 2 3
state 3 2
printf '%s\n' "$EPIC_STORY" >"$W/story.md"
with_story 2 "$W/story.md"
running "$(head_of 3)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && grep -q '^#3 waits: ' "$W/out" && grep -q '^#2 merged ' "$W/out" && grep -q "^documents land-docs/.* waits: the files of #2 wait for #3 of epic e, not merged yet" "$W/out" \
    && [ -z "$(git -C "$W/origin.git" for-each-ref 'refs/heads/land-docs/*')" ] && grep -q 'the files of #2 wait for #3' "$W/state.log" \
    && ok "files: an earlier PR of the epic waits -> the documents wait, nothing pushed, the reason in the log" || bad "files order: exit $rc: $(cat "$W/out")"
rm -f "$GHD/runs-$(head_of 3)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(docs_files)" = ".scratch/e/issues/02.md .scratch/e/issues/03.md .scratch/e/story.md " ] \
    && ok "files: run again once that PR merged -> one documents PR with both tickets and the story" || bad "files order, again: exit $rc: $(cat "$W/out") files $(docs_files)"
# the ready file cannot be read: the documents wait, nothing pushed
new_world es-unread 1
state 1
with_story 1 "$W/no-such-story.md"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && grep -q '^documents land-docs/.* waits: the file e/story.md of #1 cannot be read' "$W/out" && [ -z "$(git -C "$W/origin.git" for-each-ref 'refs/heads/land-docs/*')" ] \
    && ok "files: the ready file cannot be read -> the documents wait, nothing pushed" || bad "files unread: exit $rc: $(cat "$W/out")"
# the shape of the field: a path out of the tickets root or a relative ready file is an input error, nothing merged
for bad_files in "[{\"path\":\"../e/story.md\",\"from\":\"$(tn "$W/story.md")\"}]" '[{"path":"e/story.md","from":"story.md"}]' '[{"path":"/e/story.md","from":"/x"}]' '{"path":"e/story.md"}'; do
    new_world "es-shape-$((++shape))" 1
    state 1
    edit "s.prs[0].files = $bad_files"
    "$LAND" "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" = 1 ] && grep -q '"files" must be a list of {path, from}' "$W/out" && [ "$(merges)" = 0 ] \
        && ok "files: $bad_files -> exit 1, nothing merged" || bad "files shape $bad_files: exit $rc: $(cat "$W/out")"
done

# --- Silent mode: no documents PR, the story goes into the tickets folder outside the repository --------------------------
# silent_world <name> <N>…: a world with tickets_root null and the tickets folder $W/wf
silent_world() {
    new_world "$@"
    mkdir -p "$W/wf/e/issues" && printf '%s\n' "$(tn "$W/wf")" >"$GHD/tickets-root"
}
silent_world es-silent 1
state 1
edit 's.tickets_root=null'
printf '%s\n' "$EPIC_STORY" >"$W/story.md"
with_story 1 "$W/story.md"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$W/wf/e/story.md")" = "$EPIC_STORY" ] && ! grep -q '^pr create' "$GHD/log" && [ -z "$(git -C "$W/origin.git" for-each-ref 'refs/heads/land-docs/*')" ] \
    && grep -qx "e/story.md of #1 written into the tickets outside the repository" "$W/out" \
    && ok "silent: tickets_root null -> story.md in the tickets folder, no documents PR" || bad "silent: exit $rc: $(cat "$W/out")"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && tail -n 1 "$W/out" | grep -qx 'LAND=green' && [ "$(cat "$W/wf/e/story.md")" = "$EPIC_STORY" ] && ! grep -q "written into" "$W/out" \
    && ok "silent: run again -> the same file is not written a second time, green" || bad "silent rerun: exit $rc: $(cat "$W/out")"
# the story in the Workflow folder edited by hand since: never overwritten, red
printf 'changed by hand\n' >"$W/wf/e/story.md"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && tail -n 1 "$W/out" | grep -qx 'LAND=red' && [ "$(cat "$W/wf/e/story.md")" = "changed by hand" ] && grep -q '^files of #1 wait: e/story.md of #1 differs from the one in the tickets folder' "$W/out" \
    && ok "silent: a different file in the tickets folder -> not overwritten, LAND=red, the line says why" || bad "silent differs: exit $rc: $(cat "$W/out") file $(cat "$W/wf/e/story.md")"
# the ready file cannot be read: the run is not green
silent_world es-silent-unread 1
state 1
edit 's.tickets_root=null'
with_story 1 "$W/no-such-story.md"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && tail -n 1 "$W/out" | grep -qx 'LAND=unverified' && grep -q '^files of #1 wait: the file e/story.md of #1 cannot be read' "$W/out" && [ ! -e "$W/wf/e/story.md" ] \
    && ok "silent: the ready file cannot be read -> LAND=unverified, the line says why" || bad "silent unread: exit $rc: $(cat "$W/out")"
# an earlier PR of the epic waits: the story waits with it
silent_world es-silent-order 2 3
state 3 2
edit 's.tickets_root=null'
printf '%s\n' "$EPIC_STORY" >"$W/story.md"
with_story 2 "$W/story.md"
running "$(head_of 3)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ ! -e "$W/wf/e/story.md" ] && grep -q '^files of #2 wait: the files of #2 wait for #3 of epic e, not merged yet' "$W/out" \
    && ok "silent: an earlier PR of the epic waits -> the story is not put, the line says why" || bad "silent order: exit $rc: $(cat "$W/out")"
rm -f "$GHD/runs-$(head_of 3)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$W/wf/e/story.md")" = "$EPIC_STORY" ] && ok "silent: run again once that PR merged -> the story is put" || bad "silent order, again: exit $rc: $(cat "$W/out")"
# a folder on the path that is a symbolic link (the epic's folder points elsewhere): nothing is written through it
silent_world es-silent-link 1
state 1
edit 's.tickets_root=null'
mkdir -p "$W/elsewhere" && rm -rf "$W/wf/e" && ln -s "$W/elsewhere" "$W/wf/e"
printf '%s\n' "$EPIC_STORY" >"$W/story.md"
with_story 1 "$W/story.md"
if [ -L "$W/wf/e" ]; then
    "$LAND" "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" = 2 ] && [ ! -e "$W/elsewhere/story.md" ] && grep -q '^files of #1 wait: e/story.md of #1: .* is a symbolic link' "$W/out" \
        && ok "silent: a folder on the path is a symbolic link -> nothing written through it, LAND=red" || bad "silent link: exit $rc: $(cat "$W/out") elsewhere $(ls "$W/elsewhere")"
else
    ok "silent: a folder on the path is a symbolic link -> skipped: this system made a copy, not a link"
fi

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
