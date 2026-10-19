#!/usr/bin/env bash
# The text contract of skills/max-review (ticket worfy-review/07): a review of the whole branch before a
# risky merge — two lenses, each optionally on two Claude models, a synthesis, sceptics, four groups of
# findings and a verdict with the prefix `MAX-REVIEW:`; epic-wave runs it in section 4 for a ticket marked
# `Risk: high` and reads its verdict when a wave resumes. Besides the text, three behaviours the text relies
# on are run here: the verdict is invisible to the counts of gate rounds and to worfy's PR verdict reader,
# the resume block finds the gate's verdict under a later `gate: MAX-REVIEW:` commit, and epic-status
# ignores the `Risk: high` header line.
# Run: bash harness/bin/tests/max-review.test.sh; exit code 0 means every check passed.
# MAX_REVIEW_FILE / EPIC_WAVE_FILE point it at other copies of the SKILL.md files, PRS_FILE at another prs.ts.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
REPO="$(cd "$HARNESS/.." && pwd)"
MR="${MAX_REVIEW_FILE:-$HARNESS/skills/max-review/SKILL.md}"
EW="${EPIC_WAVE_FILE:-$HARNESS/skills/epic-wave/SKILL.md}"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
# The resume blocks commit in a temporary repository: with an empty HOME git has no identity and refuses the
# commit ("unable to auto-detect email address"), and the branch e/07 is never made.
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-t}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-t@t}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-t}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-t@t}"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
# check <name> <condition command...>
check() { local name="$1"; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }
# The texts are wrapped: phrases are looked up with line breaks folded into spaces.
flat() { tr '\n' ' ' | tr -s ' '; }
in_text() { [[ "$1" == *"$2"* ]]; }
section() { awk -v re="^## $2" '$0 ~ re {p=1; next} /^## /{p=0} p' "$1"; }    # section <file> <heading start>

for f in "$MR" "$EW"; do
    [ -f "$f" ] || { echo "FAIL missing $f"; echo "passed $pass, failed $((fail + 1))"; exit 1; }
done
mr="$(flat <"$MR")"
has() { in_text "$mr" "$1"; }

# --- 1. The skill: name, input, scope ---------------------------------------------------------------
check "max-review: frontmatter name" grep -qx 'name: max-review' "$MR"
check "max-review: invoked as /worfy:max-review" has '/worfy:max-review <branch> [<base>]'
check "max-review: the whole branch, not one rework round" has 'git diff <base>...<branch>'
check "max-review: the whole branch is said in words" has 'The review covers the whole branch, not one round of rework.'
check "max-review: edits nothing, merges nothing" has 'The mode edits nothing and merges nothing: its result is a report and a verdict.'
check "max-review: one brief, stated intent" has 'State the intent of the branch in one paragraph before the reviewers start'

# --- 2. Two lenses, the model field, the two models --------------------------------------------------
check "max-review: lens correctness (profile name корректность)" has 'lens `correctness` (the worfy profile calls it `корректность`)'
check "max-review: lens simplification (profile name упрощение)" has 'lens `simplification` (`упрощение`)'
check "max-review: two models by the model field of the Agent call" has 'the `model` field of the Agent call that starts `worfy:reviewer`'
check "max-review: the orchestrator's model — no model field" has "The first model is the orchestrator's own: start that reviewer without the \`model\` field"
check "max-review: the second model is sonnet" has 'The second model is `sonnet`: `model: "sonnet"`.'
check "max-review: an orchestrator on sonnet takes opus as the second model" has 'If the orchestrator itself runs on `sonnet`, the second model is `opus`.'
check "max-review: the same brief on both models" has 'Both models of a lens get the same brief, byte for byte'
check "max-review: one model on the owner's word" has 'One model per lens only when the owner asks for it'

# --- 3. Synthesis, sceptics, four groups ---------------------------------------------------------------
check "max-review: agreement of two models or two lenses weighs more" has 'a finding raised by both models, or by both lenses, weighs more than a finding of one reviewer'
check "max-review: sceptics — one worfy:reviewer per finding, tasked with refuting it" has 'one `worfy:reviewer` agent per `high` or `med` finding, tasked with refuting it'
check "max-review: sceptics as in epic-wave section 3" has 'as in skill `/worfy:epic-wave`, section 3 (the narrow round)'
check "max-review: a lone finding's sceptic runs on the other model" has "A finding that only one model raised gets its sceptic on the other model."
for g in 'Act on' 'Consider' 'Noted' 'Dismissed'; do
    check "max-review: group $g" has "- **$g** —"
done
check "max-review: high or med leaves Act on only with its reviewer's agreement" has "**You do not take a \`high\` or \`med\` finding out of Act on alone.**"
check "max-review: nothing is dropped silently" has 'No finding is dropped silently: what goes to no other group goes to Dismissed'

# --- 4. The verdict and the three places it is written ---------------------------------------------------
check "max-review: verdict VERIFIED" has '`MAX-REVIEW: VERIFIED`'
check "max-review: verdict REJECTED with the Act on group" has '`MAX-REVIEW: REJECTED: <Act on>`'
check "max-review: REJECTED when Act on is not empty after the sceptics" has 'when at least one finding is left in Act on after the sceptics'
check "max-review: written as a PR comment" has 'gh pr comment <N> --body "MAX-REVIEW: VERIFIED"'
check "max-review: local-green — an empty gate: MAX-REVIEW: commit" has 'commit --allow-empty -m "gate: MAX-REVIEW: VERIFIED"'
check "max-review: Silent mode — a gate: MAX-REVIEW: line in the ticket file" has "printf '\\n%s\\n' \"gate: MAX-REVIEW: VERIFIED — \$(date +%F)\" >>\"\$f\""
check "max-review: the prefix keeps the verdict out of the round counts" has 'The prefix keeps the verdict out of the counts of gate rounds'

# --- 5. What REJECTED does ------------------------------------------------------------------------------
check "max-review: REJECTED — ticket block, no rework round" has '`MAX-REVIEW: REJECTED` → `ticket block`, without a rework round'
check "max-review: the block command with the reason" has '"${CLAUDE_PLUGIN_ROOT}/bin/ticket" block <epic> <NN> "max-review REJECTED, PR #<N>: <Act on>"'
check "max-review: Autopilot — the waiting line, in English only" has "max-review REJECTED — the owner's decision"
check "max-review: outside a wave the verdict blocks nothing" has 'Outside a wave the verdict blocks nothing: the owner decides.'
check "max-review: VERIFIED — merge as usual" has '`MAX-REVIEW: VERIFIED` — the merge goes on as usual'

# --- 6. Cost, trigger, sources ---------------------------------------------------------------------------
check "max-review: the cost is named" has 'costs 2–4 times as much as an ordinary review'
check "max-review: runs only on the mark or the request" has 'Without the mark and without a request it does not run.'
check "max-review: the risk mark is the header line Risk: high" has 'the line `Risk: high` in its header'
SHA=ccb5507cec1546dc88135c1139c811e6c59115ba
check "max-review: Source line for Thermos with path and SHA" has "Source: Thermos, \`thermos/skills/thermos/SKILL.md\`, commit \`$SHA\` of \`cursor/plugins\` (MIT, Copyright (c) 2026 Cursor)"
check "max-review: Source line for pstack interrogate with path and SHA" has "Source: pstack, \`pstack/skills/interrogate/SKILL.md\`, commit \`$SHA\` of \`cursor/plugins\` (MIT, Copyright (c) 2026 Lauren Tan)"
check "max-review: borrowed rules are reworded, not copied" has 'The rules are reworded, not copied'

# --- 7. Plugin conventions --------------------------------------------------------------------------------
check "max-review: no /max-review without the worfy: prefix" bash -c '! grep -qE "(^|[^a-z:])/max-review([^a-z-]|$)" "$1"' _ "$MR"
check "max-review: no bare \`reviewer\`" bash -c '! grep -qE "\`reviewer\`" "$1"' _ "$MR"
check "max-review: no Harness paths under ~/.claude" bash -c '! grep -qE "~/\.claude/(bin|hooks)" "$1"' _ "$MR"
missing=""
while IFS= read -r p; do
    [ -e "$HARNESS/$p" ] || missing="$missing $p"
done < <(grep -oE '\$\{CLAUDE_PLUGIN_ROOT\}/[A-Za-z0-9._/-]+' "$MR" | sed 's|^${CLAUDE_PLUGIN_ROOT}/||; s|/$||' | sort -u)
check "max-review: every \${CLAUDE_PLUGIN_ROOT}/ path exists in harness/ (missing:${missing:- none})" test -z "$missing"
# Cyrillic only in the lens names of the profile and the profile placeholder of a reviewer worktree.
ALLOWED=('`корректность`' '`упрощение`' '<что-ревьюишь>')
left="$(perl -CSDA -e 'open my $fh, "<:encoding(UTF-8)", shift or die "$!\n"; local $/; my $t = <$fh>;
    for my $a (@ARGV) { $t =~ s/\Q$a\E//g } print $t' "$MR" "${ALLOWED[@]}" | perl -CSD -ne 'print "$.: $_" if /\p{Cyrillic}/' | head -n 5)"
check "max-review: no Cyrillic outside the lens names${left:+ — first: $left}" test -z "$left"

# --- 8. epic-wave, section 4: the call, the prefix, the three places, REJECTED -----------------------------
s4="$(section "$EW" '4\.' | flat)"
in4() { in_text "$s4" "$1"; }
check "epic-wave section 4: /worfy:max-review for a ticket marked Risk: high" in4 'A ticket whose header has the line `Risk: high` gets `/worfy:max-review` on its branch before its merge'
check "epic-wave section 4: after VERIFIED of section 3" in4 'after its `VERIFIED` of section 3'
check "epic-wave section 4: the MAX-REVIEW: prefix" in4 '`MAX-REVIEW: VERIFIED` or `MAX-REVIEW: REJECTED: <Act on>`'
check "epic-wave section 4: PR comment" in4 'with a PR — a comment in the PR'
check "epic-wave section 4: local-green commit" in4 'with `local-green` — an empty commit `gate: MAX-REVIEW: …` on the ticket'"'"'s branch'
check "epic-wave section 4: Silent mode line" in4 'in Silent mode — a line `gate: MAX-REVIEW: …` at the end of the ticket file'
check "epic-wave section 4: REJECTED → ticket block, no rework round" in4 '`MAX-REVIEW: REJECTED` → `ticket block`, without a rework round'
check "epic-wave section 4: the round counts do not see it" in4 'The counts of rework rounds in section 3 do not see these verdicts'
check "epic-wave section 4: Autopilot waiting line in English" in4 "max-review REJECTED — the owner's decision"

# --- 9. epic-wave, How to resume a wave -------------------------------------------------------------------
res="$(section "$EW" 'How to resume a wave' | flat)"
inr() { in_text "$res" "$1"; }
check "resume: PR — a Risk: high ticket without MAX-REVIEW: gets max-review before the merge" \
    inr 'A ticket marked `Risk: high` whose PR has no `MAX-REVIEW:` comment gets `/worfy:max-review` before its merge'
check "resume: PR — the last MAX-REVIEW: comment is its verdict" inr 'the last `MAX-REVIEW: …` comment is its verdict'
check "resume: local-green — a gate: MAX-REVIEW: commit does not restart the gate" \
    inr 'A `gate: MAX-REVIEW: …` commit is not a gate verdict: it does not restart the gate'
check "resume: local-green — the last gate: MAX-REVIEW: commit is the verdict" inr 'the last `gate: MAX-REVIEW: …` commit is its verdict'

# --- 10. Behaviour: the verdict stays out of the counts and out of worfy's PR verdict ------------------------
v_rej='MAX-REVIEW: REJECTED: src/x.ts:1 — the lock is never released'
check "a MAX-REVIEW: REJECTED PR comment is not counted as a REJECTED round" \
    test "$(jq -n --arg b "$v_rej" '[$b | select(startswith("REJECTED"))] | length')" = 0
check "a gate: MAX-REVIEW: REJECTED commit is not counted as a gate: REJECTED round" \
    test "$(printf 'gate: %s\n' "$v_rej" | grep -c '^gate: REJECTED')" = 0
# worfy reads PR comments only for the narrow round's journal, with the NARROW regex of
# src/main/github/prs.ts; the verdict is the review mark (ADR-0067). MAX-REVIEW: must not match it.
PRS="${PRS_FILE:-$REPO/src/main/github/prs.ts}"
re="$(sed -n 's|^const NARROW = /\(.*\)/u$|\1|p' "$PRS")"
check "prs.ts NARROW regex found" test -n "$re"
matches() { RE="$1" perl -e 'exit(($ARGV[0] =~ /$ENV{RE}/) ? 0 : 1)' "$2"; }
no_match() { ! matches "$@"; }
check "worfy's PR comment reader sees NARROW: REJECTED (the regex works here)" matches "$re" 'NARROW: REJECTED: x'
check "worfy's PR comment reader does not see MAX-REVIEW: REJECTED" no_match "$re" "$v_rej"
check "worfy's PR comment reader does not see MAX-REVIEW: VERIFIED" no_match "$re" 'MAX-REVIEW: VERIFIED'

# --- 11. Behaviour: the resume blocks of epic-wave on real verdicts ---------------------------------------
# Each block is cut out of the How to resume section and run. Full mode: a repository whose ticket branch
# has two gate verdicts and two `gate: MAX-REVIEW:` commits. Silent mode: a ticket file with the same
# verdicts as lines at its end. Both must print the last verdict of each kind.
resume_block() { # $1 = a string that identifies the ```bash block of the How to resume section
    section "$EW" 'How to resume a wave' \
        | awk -v m="$1" '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,m)) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}'
}
blk="$(resume_block 'log --format=%s <base>..<branch>')"
check "resume: the Full mode block that reads the gate: commits is there" test -n "$blk"
check "resume: the Full mode block is named Full mode only" inr 'The block prints both — Full mode only, where the verdicts are commits'
G="$T/repo"; mkdir -p "$G"
git -C "$G" init -q -b main && git -C "$G" commit -q --allow-empty -m base \
    && git -C "$G" switch -q -c e/07 && git -C "$G" commit -q --allow-empty -m work \
    && git -C "$G" commit -q --allow-empty -m 'gate: REJECTED: one' \
    && git -C "$G" commit -q --allow-empty -m 'gate: MAX-REVIEW: VERIFIED' \
    && git -C "$G" commit -q --allow-empty -m 'gate: VERIFIED' \
    && git -C "$G" commit -q --allow-empty -m "gate: $v_rej"
built=$?
check "resume block (Full): the test repository with the branch e/07 is built" test "$built" -eq 0
run="${blk//<repo>/$G}"; run="${run//<base>/main}"; run="${run//<branch>/e/07}"
out="$(bash -c "$run" 2>&1)"
check "resume block (Full): the gate's last verdict is gate: VERIFIED (got: $(printf '%s' "$out" | head -n 1))" \
    test "$(printf '%s\n' "$out" | sed -n 1p)" = 'GATE=gate: VERIFIED'
check "resume block (Full): the max-review verdict is the last MAX-REVIEW: commit (got: $(printf '%s\n' "$out" | sed -n 2p))" \
    test "$(printf '%s\n' "$out" | sed -n 2p)" = "MAX-REVIEW=gate: $v_rej"
git -C "$G" switch -q -c e/08 main && git -C "$G" commit -q --allow-empty -m 'gate: VERIFIED'
run="${blk//<repo>/$G}"; run="${run//<base>/main}"; run="${run//<branch>/e/08}"
out="$(bash -c "$run" 2>&1)"
check "resume block (Full): no max-review yet prints an empty MAX-REVIEW= line" \
    test "$out" = $'GATE=gate: VERIFIED\nMAX-REVIEW='

sblk="$(resume_block 'f=<ticket file>')"
check "resume: the Silent mode block that reads the ticket file is there" test -n "$sblk"
check "resume: the Silent mode block is introduced" \
    inr 'In Silent mode the verdicts are the `gate:` lines at the end of the ticket file in the Workflow folder'
TF="$T/workflow/e/issues/07-x.md"; mkdir -p "$(dirname "$TF")"
printf '%s\n' '# 07 — x' '' 'Status: claimed — 2026-10-15' 'Risk: high' '' '## Итог' '' \
    'gate: REJECTED: one — 2026-10-14' 'Consider: a finding' 'gate: MAX-REVIEW: VERIFIED — 2026-10-14' '' \
    'gate: VERIFIED — 2026-10-15' '' "gate: $v_rej — 2026-10-15" >"$TF"
out="$(bash -c "${sblk//<ticket file>/\"$TF\"}" 2>&1)"
check "resume block (Silent): the gate's last verdict is the last gate: line (got: $(printf '%s' "$out" | head -n 1))" \
    test "$(printf '%s\n' "$out" | sed -n 1p)" = 'GATE=gate: VERIFIED — 2026-10-15'
check "resume block (Silent): the max-review verdict is the last MAX-REVIEW: line (got: $(printf '%s\n' "$out" | sed -n 2p))" \
    test "$(printf '%s\n' "$out" | sed -n 2p)" = "MAX-REVIEW=gate: $v_rej — 2026-10-15"
TF2="$T/workflow/e/issues/08-y.md"
printf '%s\n' '# 08 — y' '' '## Итог' '' 'gate: VERIFIED — 2026-10-15' >"$TF2"
out="$(bash -c "${sblk//<ticket file>/\"$TF2\"}" 2>&1)"
check "resume block (Silent): no max-review yet prints an empty MAX-REVIEW= line" \
    test "$out" = $'GATE=gate: VERIFIED — 2026-10-15\nMAX-REVIEW='

# --- 12. Behaviour: epic-status ignores the Risk: high header line -----------------------------------------
for d in plain risky; do
    mkdir -p "$T/$d/e/issues"
    { printf '# 01 — x\n\nType: task\nStatus: open\n'; [ "$d" = risky ] && printf 'Risk: high\n'; printf 'Blocked by: none\n\nbody\n'; } \
        >"$T/$d/e/issues/01-x.md"
    HOME="$T" "$HARNESS/bin/epic-status" --json --root "$T/$d" >"$T/$d.json" 2>"$T/$d.err"; echo "$?" >"$T/$d.rc"
done
check "epic-status reads both tickets (exit codes $(cat "$T/plain.rc") and $(cat "$T/risky.rc"))" \
    test "$(cat "$T/plain.rc")$(cat "$T/risky.rc")" = 00
check "epic-status: Risk: high changes nothing in the JSON" cmp -s "$T/plain.json" "$T/risky.json"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
