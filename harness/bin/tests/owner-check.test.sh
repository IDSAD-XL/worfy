#!/usr/bin/env bash
# The block of skills/owner-check/SKILL.md that records the owner's decision on a manual item, cut out of SKILL.md
# itself and run under bash and zsh on temporary tickets: a Full project registered in a temporary HARNESS_HOME, and
# the Silent project of skill-blocks-world.sh. The block calls the real profile and ticket next to this test.
# Checked: Pass writes one owner-check line through `ticket evidence` and ticks the item; the same decision again
# writes no second line; a sha of "-" leaves the sha to `ticket evidence` (HEAD); Fail writes owner-check fail, leaves
# the item unticked and files one rework ticket with the same manual item and its needs line; a Pass on the rework item
# records the item it reworks too; an item that is not manual is refused and nothing is written; the owner's words
# are never run by the shell and personal data in them is replaced by a stand-in.
# Run: bash harness/bin/tests/owner-check.test.sh; exit code 0 — everything passed.
# SKILL_FILE — check another copy of skills/owner-check/SKILL.md.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/skill-blocks-world.sh"
SKILL="${SKILL_FILE:-$SKILLS/owner-check/SKILL.md}"
[ -f "$SKILL" ] || { bad "no skill file $SKILL"; echo "passed $pass, failed $fail"; exit 1; }

B="$(blockf 'owner-check: record the decision')"
[ -n "$B" ] || bad "the record block (# owner-check: record the decision) not found in $SKILL"
D="$(date +%F)"

# A Full project: registered in a temporary HARNESS_HOME, tickets in .scratch/ of its repository.
FP="$T/full"; FR="$FP/repo"; FHH="$FP/hh"
mkdir -p "$FP/home" "$FHH/gate" "$FHH/projects/fp"
git -C "$FP" init -q -b main repo && git -C "$FR" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
HEAD_SHA="$(git -C "$FR" rev-parse HEAD)"
printf '{"repos":[{"key":"fp","match":"%s","profile":"fp"}]}\n' "$(native "$FR")" >"$FHH/gate/config.json"
printf '{"schema":2,"name":"fp","mode":"full","tickets":{"root":".scratch/","done_section":"## Done when","manual_mark":"manual"}}\n' >"$FHH/projects/fp/profile.json"
FENV=(env -u CLAUDE_GATE_CONFIG -u CLAUDE_PROFILES_DIR -u CLAUDE_PROFILE_BIN -u CLAUDE_TICKET_BIN HOME="$FP/home" HARNESS_HOME="$FHH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
      GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t)

# ticket02 <issues dir>: the demo ticket file 02-demo.md with a non-manual item, a manual item with a needs line, and another non-manual item.
ticket02() {
    mkdir -p "$1"
    printf '%s\n' '# 02 — Demo' '' 'Status: claimed 2026-11-20T00:00Z' '' '## Done when' '' \
        '- [x] Unit test of the list' '- [ ] (manual) The panel shows the list' '  - needs: mac stable' \
        '- [ ] Contract test of the channel' '' '## Where in code' '' '- `src/list.ts`' >"$1/02-demo.md"
}
words() { printf '%s\n' "$@" >"$T/words.txt"; }
# run <shell> <dir> <env array name> <epic> <NN> <item> <verdict> <sha> [words file]: the block, filled in; output in $out.
run() {
    local sh="$1" dir="$2" envname="$3[@]" c="$B"
    c="${c//<epic>/$4}"; c="${c//<NN>/$5}"; c="${c//<item>/$6}"; c="${c//<verdict>/$7}"
    c="${c//<platform>/mac}"; c="${c//<copy>/stable}"; c="${c//<sha>/$8}"; c="${c//<words file>/${9:-$T/words.txt}}"
    out="$(cd "$dir" && "${!envname}" $sh -c "$c" 2>&1)"
}
lines_of() { grep -c -- "$2" "$1" 2>/dev/null || true; } # <file> <text>: how many lines hold the text

for sh in "${SHELLS[@]}"; do
    I="$FR/.scratch/p-$sh/issues"; ticket02 "$I"; F="$I/02-demo.md"
    # --- Pass: one line through ticket evidence, sha "-" gives HEAD, the item ticked ------------------------------
    words '> Works: the panel lists all three.'
    run "$sh" "$FR" FENV "p-$sh" 02 2 pass -
    want="  - evidence: owner-check pass · $D: Works: the panel lists all three. · mac stable · $HEAD_SHA"
    if [[ "$out" == *"EXIT=0"* ]] && [ "$(lines_of "$F" 'owner-check')" = 1 ] && grep -qxF -- "$want" "$F" \
        && grep -qxF -- '- [x] (manual) The panel shows the list' "$F" && [[ "$out" == *"[x] p-$sh 02 item 2"* ]]; then
        ok "$sh: Pass writes one owner-check line (sha - is HEAD) and ticks the item"
    else bad "$sh: Pass: [$out]"$'\n'"$(cat "$F")"; fi
    # The line sits under its item: after the needs line, before the next item.
    [ "$(grep -n -- '' "$F" | sed -n '9,11p' | cut -d: -f2-)" = "$(printf '%s\n' '  - needs: mac stable' "$want" '- [ ] Contract test of the channel')" ] \
        && ok "$sh: the line goes under the item, after its needs line" || bad "$sh: where the line went:"$'\n'"$(cat "$F")"
    # --- the same decision again: nothing added -----------------------------------------------------------------
    cp "$F" "$T/before"
    run "$sh" "$FR" FENV "p-$sh" 02 2 pass -
    [[ "$out" == *"already recorded: p-$sh 02 item 2"* && "$out" == *"EXIT=0"* ]] && cmp -s "$F" "$T/before" \
        && ok "$sh: the same Pass again writes no second line" || bad "$sh: repeated Pass: [$out]"$'\n'"$(cat "$F")"
    # --- an item that is not manual: refused, nothing written ---------------------------------------------------
    run "$sh" "$FR" FENV "p-$sh" 02 3 pass -
    [[ "$out" == *"refused: item 3 of p-$sh 02 is not a manual item"* && "$out" == *"EXIT=1"* ]] && cmp -s "$F" "$T/before" \
        && ok "$sh: an item that is not manual is refused and the file is untouched" || bad "$sh: non-manual item: [$out]"
    run "$sh" "$FR" FENV "p-$sh" 02 9 pass -
    [[ "$out" == *"refused: p-$sh 02 has no item 9"* && "$out" == *"EXIT=1"* ]] && cmp -s "$F" "$T/before" \
        && ok "$sh: an item the ticket lacks is refused" || bad "$sh: missing item: [$out]"
    run "$sh" "$FR" FENV "p-$sh" 02 2 maybe -
    [[ "$out" == *'refused: the verdict is pass or fail, got "maybe"'* && "$out" == *"EXIT=1"* ]] && cmp -s "$F" "$T/before" \
        && ok "$sh: a verdict other than pass or fail is refused" || bad "$sh: verdict maybe: [$out]"

    # --- Fail: owner-check fail, the item stays unticked, one rework ticket -------------------------------------
    I="$FR/.scratch/f-$sh/issues"; ticket02 "$I"; F="$I/02-demo.md"
    words '> The list is empty after a restart.'
    run "$sh" "$FR" FENV "f-$sh" 02 2 fail abcdef1
    RW="$I/03-rework-02-item-2.md"
    if [[ "$out" == *"EXIT=0"* && "$out" == *"rework ticket: f-$sh/issues/03-rework-02-item-2.md"* ]] \
        && grep -qxF -- "  - evidence: owner-check fail · $D: The list is empty after a restart. · mac stable · abcdef1" "$F" \
        && grep -qxF -- '- [ ] (manual) The panel shows the list' "$F" && [ -f "$RW" ]; then
        ok "$sh: Fail writes owner-check fail with the given sha, leaves the item unticked and files a rework ticket"
    else bad "$sh: Fail: [$out]"$'\n'"$(cat "$F")"; fi
    if [ -f "$RW" ] && grep -qxF -- "Source: owner-check fail $D of f-$sh 02, item 2 — 02-demo.md" "$RW" && grep -qxF 'Status: open' "$RW" \
        && grep -qxF 'Blocked by: None — can start immediately' "$RW" && grep -qxF '> The list is empty after a restart.' "$RW" \
        && [ "$(sed -n '/^## Done when$/,$p' "$RW" | grep -v '^$')" = "$(printf '%s\n' '## Done when' '- [ ] (manual) The panel shows the list' '  - needs: mac stable')" ]; then
        ok "$sh: the rework ticket names the item and the date, has no blockers and the same manual item with its needs line"
    else bad "$sh: rework ticket:"$'\n'"$(cat "$RW" 2>&1)"; fi
    run "$sh" "$FR" FENV "f-$sh" 02 2 fail abcdef1
    [[ "$out" == *"already recorded"* && "$out" == *"rework ticket already there: 03-rework-02-item-2.md"* ]] \
        && [ "$(lines_of "$F" 'owner-check fail')" = 1 ] && [ "$(ls "$I" | wc -l | tr -d ' ')" = 2 ] \
        && ok "$sh: the same Fail again adds no line and no second rework ticket" || bad "$sh: repeated Fail: [$out] $(ls "$I")"
    # --- Pass on the rework item: the reworked item gets owner-check pass and its tick too ----------------------
    words '> Fixed.'
    run "$sh" "$FR" FENV "f-$sh" 03 1 pass -
    if [[ "$out" == *"EXIT=0"* ]] && grep -qxF -- '- [x] (manual) The panel shows the list' "$RW" \
        && grep -qxF -- "  - evidence: owner-check pass · $D: Fixed. (rework f-$sh 03) · mac stable · $HEAD_SHA" "$F" \
        && grep -qxF -- '- [x] (manual) The panel shows the list' "$F"; then
        ok "$sh: Pass on the rework item records owner-check pass on the reworked item and ticks it"
    else bad "$sh: Pass on the rework: [$out]"$'\n'"$(cat "$F")"; fi
    st="$(cd "$FR" && "${FENV[@]}" node "$PLUGIN_ROOT/bin/ticket" evidence "f-$sh" 02 2>&1 | grep '^2\. ')"
    [ "$st" = "2. verified — (manual) The panel shows the list" ] && ok "$sh: the reworked item reads verified after the Pass" \
        || bad "$sh: the reworked item: [$st]"

    # --- the words: never run by the shell, personal data replaced ---------------------------------------------
    I="$FR/.scratch/w-$sh/issues"; ticket02 "$I"; F="$I/02-demo.md"
    words '> Seen in /home/somebody/work/app, mail jane@acme.io' "> \`touch $T/ran-$sh\` \$(touch $T/ran2-$sh) · ok"
    run "$sh" "$FR" FENV "w-$sh" 02 2 pass -
    line="$(grep -- '- evidence: owner-check' "$F")"
    if [[ "$out" == *"EXIT=0"* && "$out" == *"owner words: replaced by a stand-in: "*"home-path"* && "$out" == *"email"* ]] \
        && [[ "$line" == *"Seen in <home>/work/app, mail <email> \`touch "* && "$line" == *"\$(touch "*" - ok · mac stable · "* ]] \
        && ! grep -q 'somebody\|jane@' "$F" && [ ! -e "$T/ran-$sh" ] && [ ! -e "$T/ran2-$sh" ]; then
        ok "$sh: the words go in as text, not run, with <home> and <email> in place of personal data"
    else bad "$sh: the words: [$out] [$line]"; fi
    [ -z "$(git -C "$FR" log --format=%H -n 2 | sed -n 2p)" ] && ok "$sh: the block commits nothing" || bad "$sh: the block made a commit"

    # --- Silent mode: the line goes into the Workflow folder, the repository gets nothing ------------------------
    I="$SW/.scratch/oc-$sh/issues"; ticket02 "$I"; F="$I/02-demo.md"
    words '> Good.'
    run "$sh" "$SR" SENV "oc-$sh" 02 2 pass -
    [[ "$out" == *"EXIT=0"* ]] && [ "$(lines_of "$F" 'owner-check pass')" = 1 ] && grep -qxF -- '- [x] (manual) The panel shows the list' "$F" \
        && [ -z "$(git -C "$SR" status --porcelain)" ] \
        && ok "$sh: Silent mode — the line and the tick go into the ticket in the Workflow folder, the repository is clean" \
        || bad "$sh: Silent mode: [$out] $(git -C "$SR" status --porcelain)"
done

finish_blocks
