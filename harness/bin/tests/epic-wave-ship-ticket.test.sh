#!/usr/bin/env bash
# The text contract of skills/epic-wave and skills/ship-ticket as skills of the `worfy` plugin
# (ticket worfy-harness/06): Harness paths through ${CLAUDE_PLUGIN_ROOT}, the `worfy:` prefix on
# agents and skills, the Autopilot command, EXIT=, unchanged section numbers, English brief labels
# and no Cyrillic outside a fixed allowlist.
# Run: bash harness/bin/tests/epic-wave-ship-ticket.test.sh; exit code 0 means every check passed.
# EPIC_WAVE_FILE / SHIP_TICKET_FILE point it at other copies of the SKILL.md files.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
EW="${EPIC_WAVE_FILE:-$HARNESS/skills/epic-wave/SKILL.md}"
ST="${SHIP_TICKET_FILE:-$HARNESS/skills/ship-ticket/SKILL.md}"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
# check <name> <condition command...>
check() { local name="$1"; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }
has()   { grep -qF -- "$2" "$1"; }
lacks() { ! grep -qF -- "$2" "$1"; }
lacks_re() { ! grep -qE -- "$2" "$1"; }

for f in "$EW" "$ST"; do
    [ -f "$f" ] || { echo "FAIL missing $f"; exit 1; }
done
name_of() { if [ "$1" = "$EW" ]; then echo epic-wave; else echo ship-ticket; fi; }

# The one place a skill may name ~/.claude/bin: the rule that maps schema-1 profile values
# onto the plugin. The same sentence, on one line, in both skills.
RULE='A profile value that starts with `~/.claude/bin/` is read as `${CLAUDE_PLUGIN_ROOT}/bin/` followed by the rest of the value'

ALLOWED_CLAUDE=("$RULE" '~/.claude/projects' '~/.claude/worfy-harness' 'Write to ~/.claude')
# without <file> <string>... — prints the file with every occurrence of each literal string cut
# out. Perl, not ${text//…}: bash 3.2 (macOS) takes tens of seconds on a 30 KB UTF-8 text.
without() {
    perl -CSDA -e 'open my $fh, "<:encoding(UTF-8)", shift or die "$!\n"; local $/; my $t = <$fh>;
        for my $a (@ARGV) { $t =~ s/\Q$a\E//g } print $t' "$@"
}
without_allowed_claude() { without "$1" "${ALLOWED_CLAUDE[@]}"; }

for f in "$EW" "$ST"; do
    n="$(name_of "$f")"

    # 1. No Harness paths under ~/.claude.
    rest="$(without_allowed_claude "$f")"
    check "$n: no ~/.claude/bin, ~/.claude/hooks, \$HOME/.claude" \
        bash -c '! grep -qE "~/\.claude/(bin|hooks)|\\\$HOME/\.claude|\\\$\{HOME\}/\.claude" <<<"$1"' _ "$rest"
    check "$n: ~/.claude only as ~/.claude/projects, ~/.claude/worfy-harness and 'Write to ~/.claude'" \
        bash -c '! grep -qF "~/.claude" <<<"$1"' _ "$rest"

    # 2. Profile and Gate through the plugin root; the profile-value rule is there.
    check "$n: F is \${CLAUDE_PLUGIN_ROOT}/bin/profile --field" has "$f" '"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field <field>'
    check "$n: gate through \${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh" has "$f" 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh" fast </dev/null; echo "EXIT=$?"'
    check "$n: rule for ~/.claude/bin/ profile values" has "$f" "$RULE"
    check "$n: profile contract under the plugin root" has "$f" '${CLAUDE_PLUGIN_ROOT}/profiles/README.md'
    # Every ${CLAUDE_PLUGIN_ROOT}/<path> the skill names exists in harness/.
    missing=""
    while IFS= read -r p; do
        [ -e "$HARNESS/$p" ] || missing="$missing $p"
    done < <(grep -oE '\$\{CLAUDE_PLUGIN_ROOT\}/[A-Za-z0-9._/-]+' "$f" | sed 's|^${CLAUDE_PLUGIN_ROOT}/||; s|/$||' | sort -u)
    check "$n: every \${CLAUDE_PLUGIN_ROOT}/ path exists in harness/ (missing:${missing:- none})" test -z "$missing"

    # 3. The worfy: prefix.
    check "$n: no bare \`implementer\`, \`reviewer\`, \`scout\`" lacks_re "$f" '`(implementer|reviewer|scout)`'
    check "$n: no /ship-ticket, /epic-wave, /retro without worfy:" lacks_re "$f" '(^|[^a-z:])/(ship-ticket|epic-wave|retro)([^a-z-]|$)'
    check "$n: worfy:reviewer named" has "$f" '`worfy:reviewer`'

    # 5. EXIT=, not КОД=.
    check "$n: no КОД=" lacks "$f" 'КОД='
    check "$n: exit code printed as EXIT=\$?" has "$f" 'echo "EXIT=$?"'
done

check "epic-wave: worfy:implementer named" has "$EW" '`worfy:implementer`'
check "epic-wave: worfy:scout named" has "$EW" '`worfy:scout`'
check "epic-wave: agent types in the Agent call carry the prefix" has "$EW" 'subagent_type: "worfy:implementer"'

# 4. The Autopilot command: the new form first in the description, the old forms named.
desc="$(grep -m1 '^description:' "$EW")"
new='tickets NN, NN of epic X' old1='Ticket-ы NN, NN эпика X' old2='волна N эпика X' old3='run wave N of epic X'
check "epic-wave description names '$new', '$old1', '$old2', '$old3'" \
    bash -c '[[ "$1" == *"$2"* && "$1" == *"$3"* && "$1" == *"$4"* && "$1" == *"$5"* ]]' _ "$desc" "$new" "$old1" "$old2" "$old3"
check "epic-wave description names the new form first" \
    bash -c 'a="${1%%"$2"*}"; b="${1%%"$3"*}"; c="${1%%"$4"*}"; [ ${#a} -lt ${#b} ] && [ ${#a} -lt ${#c} ]' _ "$desc" "$new" "$old1" "$old2"
check "epic-wave: the Autopilot command in full" has "$EW" '/worfy:epic-wave tickets 05, 06, 07, 08 of epic worfy-harness'
sec1="$(awk '/^## 1\./{p=1; next} /^## /{p=0} p' "$EW")"
for form in "$new" "$old1" "$old2" "$old3"; do
    check "epic-wave section 1 (choosing the wave) names '$form'" bash -c '[[ "$1" == *"$2"* ]]' _ "$sec1" "$form"
done

# 6. Section numbers: agents and profiles refer to them ("ship-ticket, step 8").
nums() { grep -oE '^## [0-9]+\.' "$1" | tr '\n' ' '; }
check "epic-wave sections 0-5" test "$(nums "$EW")" = "## 0. ## 1. ## 2. ## 3. ## 4. ## 5. "
check "ship-ticket sections 0-11" test "$(nums "$ST")" = "## 0. ## 1. ## 2. ## 3. ## 4. ## 5. ## 6. ## 7. ## 8. ## 9. ## 10. ## 11. "
sec8="$(awk '/^## 8\./{p=1; next} /^## /{p=0} p' "$ST")"
check "ship-ticket step 8 holds the gh run watch block (agents cite it)" bash -c '[[ "$1" == *"gh run watch"* ]]' _ "$sec8"

# 7. Brief labels, shared with the agents of ticket 07.
brief="$(awk '/^```$/{if(inb){exit}; inb=1; next} inb' <(awk '/^## 2\./{p=1} /^## 3\./{p=0} p' "$EW"))"
for label in 'Goal:' 'Repository:' 'Ticket: ' '; spec: ' 'Worktree:' 'Base:' 'Files:' 'Numbers:' \
    "Wave neighbours' files (do not touch):" 'Scratchpad:' 'Write to ~/.claude: allowed | forbidden' \
    'GUI checks: yours | not yours'; do
    check "epic-wave brief label '$label'" bash -c '[[ "$1" == *"$2"* ]]' _ "$brief" "$label"
done
# GH_TOKEN comes from the plugin's SessionStart hook (worfy-harness ticket 18): the brief has no "GitHub:" line.
for old in 'GitHub:' 'Цель:' 'Репозиторий:' 'Тикет:' 'Дерево:' 'База:' 'След по файлам:' 'Номера:' 'Следы соседей' 'Запись в' 'GUI-проверки'; do
    check "epic-wave brief has no old label '$old'" bash -c '[[ "$1" != *"$2"* ]]' _ "$brief" "$old"
done

# The status block's labels stay Russian whatever the reports language: worfy reads them
# (src/shared/agent/status-block.ts; spec of worfy-harness, risk 4).
STATUS_LABELS=('— Этап:' '— Сейчас:' '— Дальше:' '— Жду:')
sec5="$(awk '/^## 5\./{p=1; next} /^## /{p=0} p' "$EW")"
for label in "${STATUS_LABELS[@]}"; do
    check "epic-wave section 5 quotes the status label '$label'" bash -c '[[ "$1" == *"$2"* ]]' _ "$sec5" "$label"
done

# Bans the translation must keep, one check each (a lost sentence is a lost rule).
check "epic-wave: do not switch the global gh account" \
    has "$EW" "do not switch the global account without the owner's permission"
check "epic-wave: gate exit code 0 without the green line is not a check" \
    bash -c 'grep -qF "$2" "$1" && grep -qF "$3" "$1" && grep -qF "$4" "$1"' _ "$EW" \
    'The gate is green only with `EXIT=0` **and** the line `[gate] зелено (fast): …` in the output:' \
    'exit code 0 without it means «ничего не прогналось»' 'and that is not a check'
check "ship-ticket: mutations only in your own worktree or on copies" \
    has "$ST" 'In both modes mutations only in your own worktree or on copies in your own scratchpad subdirectory'
check "ship-ticket: do not run other agents' scripts (the mut.sh lesson)" \
    bash -c 'grep -qF "$2" "$1" && grep -qF "$3" "$1"' _ "$ST" \
    'Do not run other' "agents' scripts from the scratchpad: a reviewer that ran someone else's \`mut.sh\` hung for three"

# The state-file rules (owner's decisions of 2026-10-08): a snapshot, rewritten only on the lines
# of one's own epic, no block per wave, review debts in the ticket's result section, the waiting
# list as one line per item, a closed epic as one line, the form check before push.
check "epic-wave: the wave rewrites only its own epic's lines" has "$EW" "The wave rewrites only its own epic's lines"
check "epic-wave: no block per wave" has "$EW" 'Do not add a block per wave'
check "epic-wave: gate debts go to the ticket, the state file only links" \
    has "$EW" 'the state file gets one line that links there'
check "epic-wave: closing the epic sorts its debts" has "$EW" 'closes the epic sorts its debts'
check "epic-wave: a closed epic is one line" has "$EW" 'The closed epic leaves the other sections and becomes one line'
check "epic-wave: docs.handoff.check before push" has "$EW" 'Run `F docs.handoff.check`, if the profile sets it,'
check "epic-wave: debts are not collected in the state file" lacks "$EW" 'as debts'
check "ship-ticket: only the lines of your own epic, no block per ticket or wave" \
    has "$ST" 'the lines of your own epic; do not add a block per ticket or per wave'
check "ship-ticket: review debts stay in the ticket's result section" \
    has "$ST" "Low-severity debts from review stay in the ticket's result section; the state file holds one"
check "ship-ticket: what waits for the owner is one line per item with a link" \
    has "$ST" 'What waits for the owner: one line per item, with a link to its ticket.'
check "ship-ticket: a finished item is deleted in the same PR" has "$ST" 'finishes is deleted in this PR.'
check "ship-ticket: an item older than two weeks becomes a ticket" has "$ST" 'An item waiting longer than two weeks becomes a ticket for the'
check "ship-ticket: the waiting list stays at about ten items" has "$ST" 'Keep the list to about ten items.'
check "ship-ticket: a closed epic is one line" has "$ST" 'A closed epic is one line among the pointers to where the rest lives.'
check "ship-ticket: docs.handoff.check before push" has "$ST" '`F docs.handoff.check` checks the form — run it before push, if the profile sets it'
check "ship-ticket: no debts section in the state file" lacks "$ST" "state file's debts"

# 7a. The local finish of local-green (worfy-harness ticket 22, rework round 1): one doer of the rebase (the
# implementer), the documents committed on the ticket branch before the fast-forward, and with single the next
# ticket waits for the local merge and starts from the main branch, not from the previous ticket's branch.
IM="${IMPLEMENTER_FILE:-$HARNESS/agents/implementer.md}"
PR="${PROFILES_README_FILE:-$HARNESS/profiles/README.md}"
check "ship-ticket: single + local-green branches from the main branch after the local merge" has "$ST" 'with `local-green` — from the main branch after the'
check "ship-ticket: no branch from the previous ticket's branch" lacks "$ST" "previous ticket's branch"
check "epic-wave: no branch from the previous ticket's branch" lacks "$EW" "previous wave ticket's branch"
check "ship-ticket: the rebase is the implementer's" has "$ST" '1. **On top of the main branch — the implementer.**'
check "ship-ticket: documents on the ticket branch before the fast-forward" has "$ST" '3. **The documents and the merge — whoever `F workflow.merge` names (the orchestrator), in one go'
check "ship-ticket: the main branch never from the checkout's HEAD" has "$ST" 'Never the branch the main checkout stands'
check "epic-wave: the rebase is always the implementer's" has "$EW" 'the rebase is always the implementer'"'"'s, in its own worktree'
check "epic-wave: local-green documents commit on the ticket's own branch" has "$EW" 'one commit on **its own branch**, made after its green `gate full`, under the lock, by the same'
check "epic-wave: single + local-green waits for the local merge (Shape)" has "$EW" 'with `local-green` locally (section 4, "Local merge",'
check "epic-wave: single + local-green waits for the local merge (Dispatch)" has "$EW" 'merge (section 4, "Local merge", `MERGED=0`).'
check "implementer: the rebase before the local merge is yours" has "$IM" 'when the orchestrator sends the branch back, rebase it onto the main branch in your own'
check "implementer: numbering.adr.dir and lessons are taken from the Workflow folder" has "$IM" 'in `numbering.adr.dir` and in `lessons: "repo:<path>"` is'
check "profiles README: an outside worktree.root is not supported until ticket 24" has "$PR" 'and not supported until worfy-harness ticket 24: an implementer subagent edits only in a tree under'
check "profiles README: no claim that the hook is reached by a subagent" lacks "$PR" 'An implementer subagent reaches such a tree only through'
check "profiles README: no claim that the hook does what Claude Code does" lacks "$PR" 'For a root inside the repository the hook does what Claude Code does'
check "profiles README: the hook is an unregistered draft, never probed through the plugin" has "$PR" '`hooks/worktree-create.sh` is an unregistered draft, never probed through the plugin'
check "profiles README: no 'not set until the owner answers' for worktree.root" lacks "$PR" 'until the owner answers worfy-harness ticket 22, item 7'

# 7b. Narrow round: the documents of a local-green ticket are committed only after a green gate, by the merge
# block, on a branch that is on top; the resume rule knows `done` on an unmerged branch; a wave with no ticket
# left to merge commits its documents on the main branch; ticket block of local-green goes there too.
check "ship-ticket: the gate comes before the documents" has "$ST" 'A red gate stops here: no documents, no merge.'
check "ship-ticket: the documents are committed inside the merge block" has "$ST" '# the documents: only now, on a branch that is on top — then the fast-forward at once'
check "ship-ticket: no documents step before the gate" lacks "$ST" "2. **The ticket's documents — the orchestrator, on the ticket branch**"
check "epic-wave: a red gate leaves no documents commit" has "$EW" 'A red gate leaves no documents commit.'
check "epic-wave: resume — done on an unmerged branch is not closed" has "$EW" 'gives 1 — the merge is still ahead and the ticket is not closed'
check "epic-wave: wave documents on main when nothing is left to merge" has "$EW" 'If it has none (the'
check "epic-wave: the wave documents block" has "$EW" 'echo "TREE=$W"; echo "TEMPORARY=$TMPW"'
check "epic-wave: ticket block of local-green in the wave's documents commit" has "$EW" "with \`local-green\` — in the wave's documents"
check "profiles README: a red gate stops the finish before the documents" has "$PR" 'A red gate stops the finish: no documents commit, no merge.'

# 7c. Owner round (2026-10-08) on the narrow round's findings: on-top checked before the documents are written and
# NOT ON TOP rolls them back; a failed documents commit moves nothing; commits take only the epic's folder and the
# state file; the temporary worktree of the wave documents is removed whatever the commit did. The blocks
# themselves run in silent-mode.test.sh, section 5b.
check "ship-ticket: on-top is checked before any document is written" has "$ST" 'branch back to the implementer (step 1) before any document is written'
check "ship-ticket: NOT ON TOP rolls the prepared documents back" has "$ST" 'restore -q --source=HEAD --staged --worktree -- "${DOCS[@]}"'
check "ship-ticket: a failed documents commit says so and moves nothing" has "$ST" 'DOCS COMMIT FAILED in $T: $M not moved'
check "ship-ticket: the documents commit takes only its paths" has "$ST" 'commit -q -m "<documents commit message>" -- "${DOCS[@]}"'
check "ship-ticket: no documents commit of the whole index" eval '! grep -qE -- "<documents commit message>\"( *;|\$)" "$ST"'
check "ship-ticket: the documents are the epic's folder, not the whole tickets root" has "$ST" 'DOCS+=("${r%/}/$E")'
check "ship-ticket: a second run after a break commits nothing twice" has "$ST" 'already committed, so it commits nothing a second time and only fast-forwards'
check "epic-wave: the wave documents commit takes only its paths" has "$EW" 'commit -q -m "<wave documents commit message>" -- "${DOCS[@]}"; rc=$?'
check "epic-wave: no add -A of the whole tickets root" lacks "$EW" 'for f in tickets.root docs.handoff.path; do p=$(F "$f")'
check "epic-wave: the temporary worktree is removed with --force" has "$EW" 'git -C <repo> worktree remove --force "$TMPW"'
# Short round 2026-10-09 (owner decision on PR #150): WorktreeCreate is not registered; a worktree.root outside the
# repository is not supported until ticket 24, and no text calls the plugin path checked.
check "ship-ticket: F worktree.root must lie under .claude/worktrees/ again" has "$ST" '`F worktree.root` must lie there'
check "ship-ticket: an outside root is not supported until ticket 24" has "$ST" 'is not supported until worfy-harness ticket 24: the plugin registers no `WorktreeCreate` hook'
check "ship-ticket: no isolation: worktree path for an outside root" lacks "$ST" 'the orchestrator starts it with `isolation: "worktree"`'
check "epic-wave: an outside root is not supported until ticket 24" has "$EW" 'is not supported until worfy-harness ticket 24. The plugin registers'
check "epic-wave: no isolation: worktree for implementers" lacks "$EW" 'start each implementer with'
check "implementer: an outside root is a false premise until ticket 24" has "$IM" 'hook that would put you there. It is a false premise of the brief'
check "implementer: no rename of a hook-made branch" lacks "$IM" 'git branch -m <ветка>'
check "implementer: the outside-root exception comes before the create-a-tree rule" eval '[ "$(grep -n -m1 -F "**\`worktree.root\` outside the repository**" "$IM" | cut -d: -f1)" -lt "$(grep -n -m1 -F "**First of all, create a working tree" "$IM" | cut -d: -f1)" ]'
WC="${WORKTREE_CREATE_FILE:-$HARNESS/hooks/worktree-create.sh}"
check "worktree-create.sh says it is not registered" has "$WC" '# NOT REGISTERED. hooks.json does not run this script'
check "worktree-create.sh says the plugin path was never probed" has "$WC" 'this script through the plugin'"'"'s hooks.json was never probed'
check "ship-ticket: <main branch> before the block is found in the block's order" has "$ST" 'the same order as the lines `M=` of the block below'
check "ship-ticket: NO MAIN BRANCH / SAME BRANCH say what happens to the prepared documents" has "$ST" '`NO MAIN BRANCH` or `SAME BRANCH` (`MERGED=1`) — a profile problem'
check "epic-wave: the temporary worktree has a fixed path" has "$EW" 'rev-parse --path-format=absolute --git-common-dir)/worfy-wave-docs"'

# 7d. Four groups of review findings (ticket worfy-review/01): the orchestrator sorts the findings into
# Act on, Consider, Noted and Dismissed — in ship-ticket step 7 and in epic-wave section 3. The levels and
# the verdicts stay; the rule names its source. The text is wrapped, so phrases are looked up in the
# section with its line breaks folded into spaces.
section() { awk -v re="^## $2\\\\." '$0 ~ re {p=1; next} /^## /{p=0} p' "$1"; }    # section <file> <number>
PSTACK_SOURCE='Source: pstack, `pstack/skills/interrogate/SKILL.md` and `pstack/skills/interrogate/references/lead-judgment.md`, commit `ccb5507cec1546dc88135c1139c811e6c59115ba`'
for pair in "$ST:7" "$EW:3"; do
    f="${pair%:*}" num="${pair##*:}" n="$(name_of "${pair%:*}")"
    # The rule itself: from its heading to the end of its Source paragraph.
    rule="$(section "$f" "$num" | awk '/^\*\*Four groups of findings\.\*\*/{p=1} p && /^Source: /{s=1} s && /^$/{exit} p' | tr '\n' ' ' | tr -s ' ')"
    in_rule() { [[ "$rule" == *"$1"* ]]; }
    check "$n section $num: the rule about four groups of findings is there" test -n "$rule"
    for group in 'Act on' 'Consider' 'Noted' 'Dismissed'; do
        check "$n section $num: group '$group'" in_rule "- **$group** — "
    done
    check "$n section $num: Act on holds no more than 5" in_rule 'No more than 5:'
    check "$n section $num: more than 5 means the selection is checked again" in_rule 'a longer list means the selection is weak'
    check "$n section $num: a confirmed high finding is not cut to fit the limit" in_rule 'is never moved out of Act on to fit the limit'
    check "$n section $num: every dismissed finding carries a one-line reason" in_rule 'each with a one-line reason'
    check "$n section $num: no finding is dropped silently" in_rule 'No finding is dropped silently'
    check "$n section $num: the groups are not a new scale" in_rule 'not a new scale: the levels `high` / `med` / `low`'
    check "$n section $num: the verdicts stay" in_rule '`VERIFIED` / `REJECTED`'
    check "$n section $num: the rule names pstack, the files and the commit" in_rule "$PSTACK_SOURCE"
    # Allowed: the verdict words and the file name SKILL.md of the source.
    caps="$(perl -e 'my %ok = map { $_ => 1 } qw(VERIFIED REJECTED NARROW SKILL); my $t = shift;
        while ($t =~ /(?<![A-Z])([A-Z]{4,})(?![A-Z])/g) { print "$1 " unless $ok{$1} }' "$rule")"
    check "$n section $num: the rule has no word in capitals${caps:+ — found: $caps}" test -z "$caps"
    [ "$n" = epic-wave ] || continue
    # The wave's gate: what the groups mean for the verdict, the rework list and the round count.
    check "$n section $num: the rework list is the Act on group" in_rule 'The implementer gets the Act on group as the rework list'
    check "$n section $num: the round count stays" in_rule 'and the count of rounds stay as they are'
    check "$n section $num: a REJECTED with an empty Act on is not VERIFIED" in_rule 'is a disagreement with the verifier, not a `VERIFIED`'
    check "$n section $num: the exchange with the verifier comes before the verdict is recorded" in_rule 'before you record anything, send the verifier your reasons through `SendMessage`'
    check "$n section $num: that exchange is not a rework round" in_rule 'that exchange is not a rework round'
    check "$n section $num: the verifier's brief does not change" in_rule "The verifier's brief does not change"
    check "$n section $num: REJECTED sends the Act on group, not the whole list" \
        bash -c '[[ "$(tr "\n" " " <"$1" | tr -s " ")" == *"$2"* ]]' _ "$f" '`SendMessage` with the Act on group of its list'
done

# 8. Cyrillic only in allowed places: the old Autopilot forms, Gate verdict words, placeholders
# of profile values, section names of Project documents and Russian examples.
ALLOWED=(
    # The old Autopilot forms and the Russian request (ADR-0033, ADR-0044).
    'Ticket-ы NN, NN эпика X' 'волна N эпика X' 'прогони волну N эпика X'
    # Gate verdict words; ticket 09 changes them.
    '[gate] зелено (fast): …' '[gate] зелено (…)' 'ничего не прогналось' 'окружение недоступно'
    '[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: …'
    # Labels of the status block, read by worfy.
    "${STATUS_LABELS[@]}"
    # Placeholders in profile values (schema 1; ticket 11 changes them).
    '<эпик>' '<ветка>' '<имя-тикета>' '<что-ревьюишь>' '<файл>' '<база>'
    # Section names of worfy's Project documents and examples of what an agent writes there.
    '## Где в коде' '## Итог' 'Готово, когда' 'Ждёт владельца' 'Волны'
    'решено без владельца, подтвердить' 'не проверено: …' 'узкий круг листовому Ticket-у — решение владельца'
)
for f in "$EW" "$ST"; do
    n="$(name_of "$f")"
    left="$(without "$f" "${ALLOWED[@]}" | perl -CSD -ne 'print "$.: $_" if /\p{Cyrillic}/' | head -n 5)"
    check "$n: no Cyrillic outside the allowlist${left:+ — first: $left}" test -z "$left"
done

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
