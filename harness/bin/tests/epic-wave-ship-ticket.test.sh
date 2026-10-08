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
    "Wave neighbours' files (do not touch):" 'Scratchpad:' 'Write to ~/.claude: allowed | forbidden' 'GitHub:' \
    'GUI checks: yours | not yours'; do
    check "epic-wave brief label '$label'" bash -c '[[ "$1" == *"$2"* ]]' _ "$brief" "$label"
done
for old in 'Цель:' 'Репозиторий:' 'Тикет:' 'Дерево:' 'База:' 'След по файлам:' 'Номера:' 'Следы соседей' 'Запись в' 'GUI-проверки'; do
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
    'решено без владельца, подтвердить' 'не проверено: …'
)
for f in "$EW" "$ST"; do
    n="$(name_of "$f")"
    left="$(without "$f" "${ALLOWED[@]}" | perl -CSD -ne 'print "$.: $_" if /\p{Cyrillic}/' | head -n 5)"
    check "$n: no Cyrillic outside the allowlist${left:+ — first: $left}" test -z "$left"
done

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
