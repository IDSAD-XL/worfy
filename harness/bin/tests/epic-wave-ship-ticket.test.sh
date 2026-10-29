#!/usr/bin/env bash
# The text contract of skills/epic-wave and skills/ship-ticket as skills of the `worfy` plugin
#: Harness paths through ${CLAUDE_PLUGIN_ROOT}, the `worfy:` prefix on
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
    check "$n: gate through \${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" has "$f" 'node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null; echo "EXIT=$?"'
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

    # 5. EXIT=, not the old Russian exit-code label.
    check "$n: no old exit-code line" lacks "$f" 'КОД='
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
check "epic-wave: the Autopilot command in full" has "$EW" '/worfy:epic-wave tickets 05, 06, 07, 08 of epic demo'
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

# 6a. ship-ticket step 5: the smallest complete change. Step 4 — the failing
# test first — stays word for word as it was, and step 5 keeps its first paragraph.
st4="$(awk '/^## 4\./{p=1; next} /^## /{p=0} p' "$ST")"
want4='
```bash
<F commands.test_one>        # placeholder <file>
```

Make sure the test is red, and only then fix. What must be running for the tests —
`F commands.requires`; pitfalls of a targeted run — `rules.md`.'
check "ship-ticket step 4 (failing test first) is unchanged" test "$st4" = "$want4"
st5="$(awk '/^## 5\./{p=1; next} /^## /{p=0} p' "$ST")"
in_st5() { printf '%s\n' "$st5" | tr '\n' ' ' | tr -s ' ' | grep -qF -- "$1"; }
check "ship-ticket step 5 keeps its first paragraph" in_st5 \
    'Along the files listed in the ticket (section `F tickets.trail_section`). Going outside that list is a reason to say so, not to widen the change silently.'
check "ship-ticket step 5: the smallest complete change, after the failing test" in_st5 \
    "The change is the smallest one that does the whole ticket. It comes after step 4 — the failing test stays first — and it never drops an item of the ticket's list of what \"done\" means."
check "ship-ticket step 5: before the edit, every place the change has to reach" in_st5 \
    '- Before the edit, list every place the change has to reach: callers, tests, fixtures, configuration, exports.'
check "ship-ticket step 5: a bug — grep every caller, fix once in the shared code" in_st5 \
    '- For a bug, grep every caller of the function you change and fix the cause once, in the shared code.'
check "ship-ticket step 5: the order of options is introduced" in_st5 '- Then take the first of these options that solves the whole task:'
options5="$(printf '%s\n' "$st5" | grep -E '^ +[1-6]\. ' | sed -E 's/^ +//')"
check "ship-ticket step 5: the six options, indented, in their order" test "$options5" = '1. Nothing: the task does not need this code.
2. Code the repository already has — a helper, a component, a pattern; use it the way the code around it does.
3. The standard library or a feature of the platform.
4. A dependency the project already installs; a new dependency for a few lines is not an option.
5. One line that a reader understands at a glance.
6. The least new code that works.'
check "ship-ticket step 5: what is never cut" in_st5 \
    '- Never cut, whatever the size of the change: checks of input at a trust boundary, error handling that keeps data from being lost, security, accessibility, anything the ticket asks for.'
check "ship-ticket step 5: the shortcut comment and its form" in_st5 \
    '- A simplification with a known limit gets a comment in the comment syntax of the language: `shortcut: <limit>, <when to redo>` — what the simple code does not handle, then the condition under which it has to be replaced.'
check "ship-ticket step 5: a comment without the condition is incomplete" in_st5 \
    'A comment without the part after the comma is incomplete: nobody will know when to redo the code.'
check "ship-ticket step 5: the script that lists the comments" in_st5 \
    '`"${CLAUDE_PLUGIN_ROOT}/bin/shortcut-ledger"` lists the `shortcut:` comments of a work tree and marks the incomplete ones `no-trigger`.'
check "ship-ticket step 5: the source — ponytail, the files, the commit, what was taken" in_st5 \
    'Source: ponytail, `skills/ponytail/SKILL.md` and `skills/ponytail-debt/SKILL.md`, commit `9cc65d03aa2da1db7121b912d03596409ee340b8` of `DietrichGebert/ponytail` (tag v5.1.0) — the order of options, the list of places before the edit, the rule for a bug, what is never cut, the `shortcut:` comment and the `no-trigger` mark.'
check "ship-ticket step 5: what is reworded and why the licence goes with it" in_st5 \
    'The rules are reworded; the marker `shortcut:` and the mark `no-trigger` are taken as they are. The order of options follows the source closely, so its licence goes with it — `LICENSE` of the source at that commit:'
licence5="$(printf '%s\n' "$st5" | awk '/^```text$/{b=1; t=""; next} b && /^```$/{b=0; last=t; next} b{t = t $0 "\n"} END{printf "%s", last}')"
check "ship-ticket step 5: the full MIT licence of ponytail, with its copyright line" test "$licence5" = 'MIT License

Copyright (c) 2026 DietrichGebert

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.'
check "ship-ticket step 5: the licence closes the step" test "$(printf '%s\n' "$st5" | grep -v '^$' | tail -n 1)" = '```'

# 7. Brief labels, shared with the agents.
brief="$(awk '/^```$/{if(inb){exit}; inb=1; next} inb' <(awk '/^## 2\./{p=1} /^## 3\./{p=0} p' "$EW"))"
for label in 'Goal:' 'Repository:' 'Ticket: ' '; spec: ' 'Worktree:' 'Base:' 'Files:' 'Numbers:' \
    "Wave neighbours' files (do not touch):" 'Scratchpad:' 'Write to ~/.claude: allowed | forbidden' \
    'GUI checks: yours | not yours'; do
    check "epic-wave brief label '$label'" bash -c '[[ "$1" == *"$2"* ]]' _ "$brief" "$label"
done
# Temporary HOME: the brief line, when to set it, the recipe (the same text as in agents/implementer.md
# and agents/reviewer.md, agents-text.test.sh), and the verifier's brief carries the line too.
check "epic-wave brief label 'Temporary HOME: yes | no'" bash -c '[[ "$1" == *"$2"* ]]' _ "$brief" 'Temporary HOME: yes | no'
RECIPE='H="$(node "${CLAUDE_PLUGIN_ROOT}/hooks/eval-env.cjs" harness-home)"   # the real Harness home, before HOME changes
T="$(mktemp -d)"; TW="$(cd "$T" && { pwd -W 2>/dev/null || pwd; })"   # TW: the folder as Windows names it (Git Bash)
: > "$T/.zshenv"; : > "$T/.zprofile"; : > "$T/.zshrc"   # without them zsh -ilc waits for the new-user prompt
( export HOME="$T" USERPROFILE="$TW"; <commands.verify> ); echo "EXIT=$?"
( export HOME="$T" USERPROFILE="$TW" HARNESS_HOME="$H"; node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null ); echo "EXIT=$?"'
sec2="$(awk '/^## 2\./{p=1; next} /^## /{p=0} p' "$EW")"
sec3="$(awk '/^## 3\./{p=1; next} /^## /{p=0} p' "$EW")"
flat() { tr '\r\n' '  ' <<<"$1" | tr -s ' '; }
in_flat() { [[ "$(flat "$1")" == *"$2"* ]]; } # $1 = text, $2 = literal sentence; line breaks as spaces
check "epic-wave section 2: the temporary HOME recipe, word for word" bash -c '[[ "$1" == *"$2"* ]]' _ "$sec2" "$RECIPE"
check "epic-wave section 2: the brief always fills Temporary HOME" in_flat "$sec2" 'The brief always fills the "Temporary HOME" line too.'
check "epic-wave section 2: when Temporary HOME is yes, when no" in_flat "$sec2" \
    '`yes` when the tests or checks of the ticket must not touch the real home folder: "Write to ~/.claude" is `forbidden` and the tests may still write under HOME (a real Claude Code, the Agent SDK, an installer, a tool'"'"'s cache or config), or the run must not read the developer'"'"'s own shell rc files. `no` — the agent runs with its own HOME.'
check "epic-wave section 2: the verifier's brief carries Temporary HOME" in_flat "$sec2" \
    'The verifier'"'"'s brief (section 3) carries the same "Scratchpad", "Write to ~/.claude" and "Temporary HOME" lines'
EXIT3_RULE='An exit 3 of the gate under a temporary HOME without `HARNESS_HOME` is an error of the run'"'"'s environment, not of the code: run the gate again by the recipe, and do not take that exit 3 for the gate'"'"'s verdict.'
check "epic-wave section 2: the whole exit-3 rule under a temporary HOME" in_flat "$sec2" "$EXIT3_RULE"
check "epic-wave section 3: the verifier runs the gate by the recipe, with the whole exit-3 rule" in_flat "$sec3" \
    'With "Temporary HOME: yes" in its brief the verifier runs the gate by the recipe of section 2. '"$EXIT3_RULE"
check "epic-wave section 2: the gate's writes into the real Harness home are allowed" in_flat "$sec2" \
    'With `HARNESS_HOME` on the real Harness home the gate writes its verdict, markers and cache there (`<HARNESS_HOME>/gate/state`), as it does without a temporary HOME. That write is allowed whatever the brief'"'"'s line "Write to ~/.claude" says: it is the Harness home, not the transcripts in `~/.claude/projects`.'
check "epic-wave section 2: the Harness home is read before HOME changes, Windows gets USERPROFILE" in_flat "$sec2" \
    'Node takes the home folder from HOME, and on Windows from USERPROFILE, so both point at the temporary folder'
# GH_TOKEN comes from the plugin's SessionStart hook: the brief has no "GitHub:" line.
for old in 'GitHub:' 'Цель:' 'Репозиторий:' 'Тикет:' 'Дерево:' 'База:' 'След по файлам:' 'Номера:' 'Следы соседей' 'Запись в' 'GUI-проверки'; do
    check "epic-wave brief has no old label '$old'" bash -c '[[ "$1" != *"$2"* ]]' _ "$brief" "$old"
done

# The status block's labels are fixed English tokens whatever the reports language: worfy reads
# them (src/shared/agent/status-block.ts).
STATUS_LABELS=('— Stage:' '— Now:' '— Next:' '— Waiting:')
sec5="$(awk '/^## 5\./{p=1; next} /^## /{p=0} p' "$EW")"
for label in "${STATUS_LABELS[@]}"; do
    check "epic-wave section 5 quotes the status label '$label'" bash -c '[[ "$1" == *"$2"* ]]' _ "$sec5" "$label"
done

# bin/profile always prints language.docs (en when the profile does not set it), so the skills do not
# describe a profile without that field.
for f in "$EW" "$ST"; do
    n="$(name_of "$f")"
    check "$n: no branch for a profile without language.docs" lacks "$f" 'while the profile has no such field'
    check "$n: language.docs is en when the profile does not set it" has "$f" '`F language.docs` (`en` when the profile does not set it)'
done

# Bans the translation must keep, one check each (a lost sentence is a lost rule).
check "epic-wave: do not switch the global gh account" \
    has "$EW" "do not switch the global account without the owner's permission"
check "epic-wave: gate exit code 0 without the green line is not a check" \
    bash -c 'grep -qF "$2" "$1" && grep -qF "$3" "$1" && grep -qF "$4" "$1"' _ "$EW" \
    'The gate is green only with `EXIT=0` **and** the line `[gate] green (fast): …` in the output:' \
    'exit code 0 without it means `[gate] nothing ran (…)`' 'and that is not a check'
check "epic-wave: both verdicts of the other platform take the green line of a gate of the release before" \
    bash -c '[ "$(tr -s " \n" " " <"$1" | grep -o "prints the same line with a Russian word in place of \`green\`" | wc -l)" -eq 2 ]' _ "$EW"
check "ship-ticket: gate exit code 0 is green only with the English green line" \
    bash -c 'grep -qF "$2" "$1" && grep -qF "$3" "$1"' _ "$ST" \
    'Gate exit codes: `0` — green, only if the output has the line `[gate] green (…)`' 'line `[gate] not verified: …` names the reason'
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

# 7a. The local finish of local-green: one doer of the rebase (the
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
check "profiles README: an outside worktree.root is not supported yet" has "$PR" 'and not supported yet: an implementer subagent edits only in a tree under'
check "profiles README: no claim that the hook is reached by a subagent" lacks "$PR" 'An implementer subagent reaches such a tree only through'
check "profiles README: no claim that the hook does what Claude Code does" lacks "$PR" 'For a root inside the repository the hook does what Claude Code does'
check "profiles README: the hook is an unregistered draft, never probed through the plugin" has "$PR" '`hooks/worktree-create.sh` is an unregistered draft, never probed through the plugin'
check "profiles README: no 'not set until the owner answers' for worktree.root" lacks "$PR" 'until the owner answers'

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
# Short round 2026-10-09: WorktreeCreate is not registered; a worktree.root outside the
# repository is not supported yet, and no text calls the plugin path checked.
check "ship-ticket: F worktree.root must lie under .claude/worktrees/ again" has "$ST" '`F worktree.root` must lie there'
check "ship-ticket: an outside root is not supported yet" has "$ST" 'is not supported yet: the plugin registers no `WorktreeCreate` hook'
check "ship-ticket: no isolation: worktree path for an outside root" lacks "$ST" 'the orchestrator starts it with `isolation: "worktree"`'
check "epic-wave: an outside root is not supported yet" has "$EW" 'is not supported yet. The plugin registers'
check "epic-wave: no isolation: worktree for implementers" lacks "$EW" 'start each implementer with'
check "implementer: an outside root is a false premise" has "$IM" 'hook that would put you there. It is a false premise of the brief'
check "implementer: no rename of a hook-made branch" lacks "$IM" 'git branch -m <branch>'
check "implementer: the outside-root exception comes before the create-a-tree rule" eval '[ "$(grep -n -m1 -F "**\`worktree.root\` outside the repository**" "$IM" | cut -d: -f1)" -lt "$(grep -n -m1 -F "**First of all, create a working tree" "$IM" | cut -d: -f1)" ]'
WC="${WORKTREE_CREATE_FILE:-$HARNESS/hooks/worktree-create.sh}"
check "worktree-create.sh says it is not registered" has "$WC" '# NOT REGISTERED. hooks.json does not run this script'
check "worktree-create.sh says the plugin path was never probed" has "$WC" 'this script through the plugin'"'"'s hooks.json was never probed'
check "ship-ticket: <main branch> before the block is found in the block's order" has "$ST" 'the same order as the lines `M=` of the block below'
check "ship-ticket: NO MAIN BRANCH / SAME BRANCH say what happens to the prepared documents" has "$ST" '`NO MAIN BRANCH` or `SAME BRANCH` (`MERGED=1`) — a profile problem'
check "epic-wave: the temporary worktree has a fixed path" has "$EW" 'rev-parse --path-format=absolute --git-common-dir)/worfy-wave-docs"'

# 7d. Four groups of review findings: the orchestrator sorts the findings into
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
    sec="$(section "$f" "$num" | tr '\n' ' ' | tr -s ' ')"
    in_sec() { [[ "$sec" == *"$1"* ]]; }
    not_in_rule() { [[ "$rule" != *"$1"* ]]; }
    # Who raised the findings: the lens reviewers of a ticket, or the verifier of a wave's gate.
    if [ "$n" = epic-wave ]; then who=verifier; else who=reviewer; fi
    check "$n section $num: the rule about four groups of findings is there" test -n "$rule"
    # Whole sentences, not fragments: a changed word inside one changes the rule.
    check "$n section $num: Act on is confirmed high and med, and goes to rework" \
        in_rule '- **Act on** — confirmed `high` and `med` findings; they go to rework.'
    check "$n section $num: Act on holds no more than 5, a longer list is checked again" \
        in_rule 'No more than 5: a longer list means the selection is weak, so check every item again — is it confirmed, is it one defect reported twice.'
    check "$n section $num: Consider is med and low whose fix is disputable or too costly" \
        in_rule '- **Consider** — `med` and `low` findings whose fix is disputable or costs more than it gives;'
    check "$n section $num: a high finding never goes to Consider" in_rule 'A `high` finding never goes here.'
    check "$n section $num: Noted is low findings and debt lines" \
        in_rule '- **Noted** — `low` findings that need no fix now and the `[low] debt: …` lines of a'
    check "$n section $num: Dismissed is refuted findings only, each with a one-line reason" \
        in_rule '- **Dismissed** — findings you refuted, each with a one-line reason. Deciding not to fix a finding does not refute it: such a `med` or `low` finding belongs to Consider.'
    check "$n section $num: no finding is dropped silently, an empty group is 'none'" \
        in_rule 'No finding is dropped silently: what goes to no other group goes to Dismissed, so the owner sees what was rejected and can overrule it. An empty group is written as "none".'
    check "$n section $num: the groups are not a new scale" in_rule 'not a new scale: the levels `high` / `med` / `low`'
    check "$n section $num: the verdicts stay" in_rule '`VERIFIED` / `REJECTED`'
    check "$n section $num: the orchestrator does not judge the level" not_in_rule 'is its level right'
    # A high or med finding leaves Act on only with the agreement of whoever raised it.
    check "$n section $num: no high or med finding leaves Act on on the orchestrator's word alone" \
        in_rule '**You do not take a `high` or `med` finding out of Act on alone.** A `low` finding you sort yourself. A `high` or `med` finding that you would put into Consider, Noted or Dismissed, or whose level you think is too high, goes back to the '"$who"
    check "$n section $num: a withdrawn or lowered finding is marked as agreed" \
        in_rule "- a finding the $who withdraws, or agrees to lower or to set aside, goes to the group it agreed to, and its line says \"agreed by the $who\";"
    check "$n section $num: a finding the $who insists on stays in Act on" \
        in_rule "- a finding the $who insists on stays in Act on, at the $who's level;"
    check "$n section $num: the rule names pstack, the files and the commit" in_rule "$PSTACK_SOURCE"
    # Allowed: the verdict words and the file name SKILL.md of the source.
    caps="$(perl -e 'my %ok = map { $_ => 1 } qw(VERIFIED REJECTED NARROW SKILL); my $t = shift;
        while ($t =~ /(?<![A-Z])([A-Z]{4,})(?![A-Z])/g) { print "$1 " unless $ok{$1} }' "$rule")"
    check "$n section $num: the rule has no word in capitals${caps:+ — found: $caps}" test -z "$caps"
    if [ "$n" = ship-ticket ]; then
        check "$n section $num: the four groups are shown to the user" \
            in_rule 'sort all their findings into four groups and show the four groups to the user.'
        check "$n section $num: the level is the reviewer's, the orchestrator only proposes a change" \
            in_rule "The level of a finding is its reviewer's: you do not change it, you may only propose a change to that reviewer (below)."
        check "$n section $num: a finding its reviewer stands by is not cut to fit the limit" \
            in_rule 'A finding its reviewer stands by is never moved out of Act on to fit the limit: if more than 5 remain, say so in the report.'
        check "$n section $num: the finding goes back to its reviewer before rework" \
            in_rule 'goes back to the reviewer that raised it: before anything goes to rework, send that reviewer your reason through `SendMessage`. Its answer decides:'
        check "$n section $num: a reviewer that cannot answer leaves the finding in Act on" \
            in_rule '- if the reviewer cannot answer any more, the finding stays in Act on.'
        check "$n section $num: the groups are written down when sorted, to survive a session break" \
            in_rule "Write the Consider, Noted and Dismissed lines into the ticket's result section as soon as they are sorted, not at step 11: the brief of the repeat review is built from the groups, and a session break must not lose them."
        check "$n section $num: the repeat review gets the Act on group as the first round's findings" \
            in_sec "The brief gives the first round's findings — its Act on group, without the other groups — and the diff of the rework only."
        check "$n section $num: a finding set aside in the first round is not ground (a)" \
            in_sec "Only the Act on group counts for (a): what the first round put into Consider, Noted or Dismissed — a \`high\` or \`med\` finding only with its reviewer's agreement — is not ground (a)."
        continue
    fi
    # The wave's gate: what the groups mean for the verdict, the rework list and the round count.
    check "$n section $num: the wave's report shows the groups" \
        in_rule "the wave's report (section 5) shows the four groups of every ticket under its table."
    check "$n section $num: the level is the verifier's, the orchestrator only proposes a change" \
        in_rule "The level of a finding is the verifier's: you do not change it, you may only propose a change to the verifier (below)."
    check "$n section $num: the rework list is the Act on group" in_rule 'The implementer gets the Act on group as the rework list.'
    check "$n section $num: a finding the verifier stands by is not cut to fit the limit" \
        in_rule 'A finding the verifier stands by is never moved out of Act on to fit the limit: if more than 5 remain, say so in the report.'
    check "$n section $num: the round count stays" in_rule 'and the count of rounds stay as they are'
    check "$n section $num: the finding goes back to the verifier before the verdict is recorded" \
        in_rule 'goes back to the verifier first: before the verdict is recorded, send the verifier your reason for each such finding through `SendMessage`. Its answer decides, finding by finding:'
    check "$n section $num: a verifier that cannot answer leaves the findings in Act on" \
        in_rule '- if the verifier cannot answer any more, every such finding stays in Act on.'
    check "$n section $num: a REJECTED that would leave Act on empty goes to the verifier too" \
        in_rule 'The same exchange is due when a `REJECTED` would leave Act on empty for another reason (its list holds only `low` findings): ask the verifier which of them block; what it insists on goes to Act on, whatever its level.'
    check "$n section $num: the recorded verdict is the verifier's, never the orchestrator's" \
        in_rule "The verdict you record is the one the verifier's answer carries, never your own: \`VERIFIED\` only when the verifier itself says so."
    check "$n section $num: the implementer never gets an empty list" \
        in_rule 'A `REJECTED` that stands therefore has at least one finding in Act on, and the implementer never gets an empty list.'
    check "$n section $num: that exchange is not a rework round" in_rule 'That exchange is not a rework round.'
    check "$n section $num: REJECTED: gate 3 is not a disagreement" \
        in_rule '`REJECTED: gate 3 …` is not a disagreement and has no findings to sort: it keeps its own rule above.'
    check "$n section $num: the verifier's brief does not change" in_rule "The verifier's brief does not change: the verifier does not sort"
    # The recorded verdict carries the groups, and the counts of rounds still see verdicts only.
    check "$n section $num: the recorded REJECTED holds Act on first, then a line per group" \
        in_rule "The first line of a recorded \`REJECTED\` holds the Act on group — the rework list — and each other group that is not empty follows as a line that starts with the group's name:"
    check "$n section $num: the groups survive a session break" in_rule '**The recorded verdict carries the groups**, so they survive a session break.'
    check "$n section $num: local-green — the group lines are the body of the gate: commit" \
        in_rule 'With `local-green` the first line is the subject of the `gate: REJECTED: …` commit and the group lines are its body.'
    check "$n section $num: Silent mode — the group lines follow the gate: line" \
        in_rule 'In Silent mode the group lines follow the `gate: REJECTED: …` line in the ticket file.'
    check "$n section $num: no group line starts like a verdict" \
        in_rule 'No group line starts with `REJECTED` or `gate:`, so the counts above still count verdicts only.'
    # The example itself: its first line is the verdict, and the commands that count rounds see one verdict in it.
    example="$(section "$f" "$num" | awk '/^\*\*The recorded verdict carries the groups\*\*/{p=1} p && /^```$/{if (b) exit; b=1; next} b')"
    check "$n section $num: the example of a recorded REJECTED has the four lines" test "$example" = \
        'REJECTED: <Act on: the rework list>
Consider: <findings>
Noted: <findings>
Dismissed: <findings, each with its reason>'
    check "$n section $num: the example counts as one REJECTED for a PR comment" \
        test "$(jq -n --arg body "$example" '[$body | select(startswith("REJECTED"))] | length')" = 1
    check "$n section $num: the example counts as one REJECTED in a Silent-mode ticket file" \
        test "$(printf 'gate: %s\n' "$example" | grep -c '^gate: REJECTED')" = 1
    check "$n section $num: REJECTED sends the Act on group, not the whole list" \
        in_sec 'Findings: <the Act on group of the recorded `REJECTED`'
    check "$n section $num: the second round gets the Act on group as the first round's list" \
        in_sec "The brief gives the first round's list — the Act on group of the recorded \`REJECTED\`, without the lines of the other groups — and the diff of the rework only"
    check "$n section $num: a finding set aside in the first round is not ground (a)" \
        in_sec "Only the items of that list count for (a): what the first round put into Consider, Noted or Dismissed — a \`high\` or \`med\` finding only with the verifier's agreement — is not ground (a)."
done
# 7e. A rework round goes to a fresh implementer with a short brief, not through SendMessage to the old one
# whose prompt cache has expired; the exception is an implementer that reported less than 5 min ago.
rw3="$(section "$EW" 3 | tr '\n' ' ' | tr -s ' ')"
in_rw3() { [[ "$rw3" == *"$1"* ]]; }
check "epic-wave section 3: a rework round is a fresh implementer with the rework brief" \
    in_rw3 'The round is a new agent `worfy:implementer` with the rework brief below, on the same branch — not `SendMessage` to the old implementer'
check "epic-wave section 3: the orchestrator removes the previous round's idle worktree and launches with isolation worktree" \
    in_rw3 'Otherwise the previous round'"'"'s worktree is idle: remove it and launch the new agent with the Agent parameter `isolation: "worktree"`, which gives it a fresh tree of its own. What happens to the branch depends on where it lives:'
check "epic-wave section 3: a pushed branch is deleted locally and checked out from origin" \
    in_rw3 '- pushed (`pr-green-ci`): `git worktree remove <worktree>`, then `git branch -D <branch>`; the new agent checks out the branch from origin (`git checkout -B <branch> origin/<branch>`).'
# With local-green or without origin the local branch is the only copy of the rounds' commits: it is never deleted.
rw_local="$(section "$EW" 3 | awk '/^- `local-green` or a repository without `origin`/{p=1} p && /^$/{exit} p' | tr '\n' ' ' | tr -s ' ')"
check "epic-wave section 3: the local-green / no-origin rule exists" \
    test -n "$rw_local"
check "epic-wave section 3: local-green / no origin keeps the branch — the worktree is removed, the branch is not" \
    bash -c '[[ "$1" == *"the local branch is the only copy of the first round'"'"'s commits and of the \`gate: REJECTED\` commits that count the rounds: \`git worktree remove <worktree>\` only, the branch stays (no \`git branch -D\`);"* && "$1" != *"git branch -D <branch>"* && "$1" != *"origin/<branch>"* ]]' _ "$rw_local"
check "epic-wave section 3: local-green / no origin — the new agent checks out the local branch" \
    bash -c '[[ "$1" == *"the new agent checks out the local branch (\`git checkout <branch>\`; worktrees share the branches)."* ]]' _ "$rw_local"
check "epic-wave section 3: the old wording — every idle branch is pushed and deleted — is gone" \
    bash -c '[[ "$1" != *"is idle and its branch is pushed: remove that worktree"* ]]' _ "$rw3"
check "epic-wave section 3: a refused git worktree remove is looked into, not forced" \
    in_rw3 'If `git worktree remove` refuses (untracked or modified files), look at what is there instead of forcing it. Either way the new agent rebases first.'
check "epic-wave section 3: a rework implementer is never sent into an existing tree" \
    in_rw3 'Never send it into an existing tree: `EnterWorktree` refuses a subagent started at the repository root, by `path` and by `name`.'
check "epic-wave section 3: the old wording — the rework in the same worktree — is gone" \
    bash -c '[[ "$1" != *"in the same worktree and on the same branch"* ]]' _ "$rw3"
check "epic-wave section 3: the 5 min exception" \
    in_rw3 'The exception: the old implementer sent its final report less than 5 min before this brief — then `SendMessage` to it with the same brief; a report time you do not know counts as older.'
# The rule's paragraph and the brief template stay within 100 characters a line.
rw_lines="$(section "$EW" 3 | awk '/^`REJECTED` \(except/{p=1} p; p && /^```$/{n++} n == 2{exit}')"
check "epic-wave section 3: the rework rule and brief keep lines within 100 characters" \
    bash -c '[ -n "$1" ] && perl -CSDA -e '"'"'for (split /\n/, shift) { exit 1 if length > 100 }'"'"' "$1"' _ "$rw_lines"
check "epic-wave section 3: the old wording — REJECTED to the same implementer — is gone" \
    lacks "$EW" 'goes to the same implementer through'
check "epic-wave section 3: every rework round of the skill follows the rule" \
    in_rw3 'Every rework round of this skill follows this rule:'
# The brief template: one fenced block after its heading, with the six labelled lines.
rework_brief="$(section "$EW" 3 | awk '/^\*\*The rework brief\*\*/{p=1} p && /^```$/{if (b) exit; b=1; next} b')"
for label in Rework Repository Ticket PR Branch Worktree Head Findings 'Verifier report'; do
    check "epic-wave section 3: the rework brief has the line '$label:'" \
        bash -c 'grep -q "^$2: " <<<"$1"' _ "$rework_brief" "$label"
done
brief_has() { grep -qF -- "$1" <<<"$rework_brief"; }
check "epic-wave section 3: the rework brief names the spec" brief_has 'Ticket: <F tickets.path for NN>; spec: <F tickets.spec>'
check "epic-wave section 3: the rework brief carries Files and Wave neighbours' files of the first brief" \
    brief_has "# plus the Files, Wave neighbours' files, Scratchpad,"
check "epic-wave section 3: Head is from before the rebase, which the implementer does first" \
    bash -c 'grep -q "^Head: <sha> .*# the branch HEAD before the rework; the implementer rebases it first$" <<<"$1"' _ "$rework_brief"
check "epic-wave section 3: the rework brief reminds of a test per new behaviour" \
    bash -c '[[ "$(tr "\n" " " <<<"$1" | tr -s " ")" == *"$2"* ]]' _ "$rework_brief" \
    'Cover every new behaviour of the rework with a test that turns red on a mutant of that change'
check "epic-wave section 3: the rework brief's Worktree is the launch tree, where the branch is checked out from origin" \
    bash -c 'grep -qx "Worktree: your launch tree (isolation \"worktree\") — git checkout -B <branch> origin/<branch>" <<<"$1"' _ "$rework_brief"
check "epic-wave section 3: the rework brief's Worktree line names the local checkout for local-green / no origin" \
    bash -c 'grep -A1 "^Worktree: " <<<"$1" | grep -qx " *# local-green or no origin: git checkout <branch> (the local branch)"' _ "$rework_brief"
check "epic-wave section 4: the cleanup after the merge deletes a rework round's isolation branch" \
    in_flat "$(section "$EW" 4)" 'A rework round'"'"'s tree (`isolation: "worktree"`, section 3) leaves its own branch behind after the agent checked the ticket branch out there: delete it too (`git branch -D worktree-agent-<id>`).'
check "epic-wave section 3: the old Worktree line — work in it, do not create one — is gone" \
    lacks "$EW" 'do not create one'
check "epic-wave section 3: the second round's diff starts at the head after the rebase, from the PR comment" \
    in_rw3 'where `<sha>` is the head after the rebase the rework starts with, as the implementer names it in its PR comment (local-green: its report) — not the brief'"'"'s `Head`, which is from before that rebase.'
check "epic-wave section 3: the old wording — the HEAD before the rework, already after the rebase — is gone" \
    bash -c '[[ "$1" != *"already after the rebase"* ]]' _ "$rw3"
rw4="$(section "$EW" 4 | tr '\n' ' ' | tr -s ' ')"
in_rw4() { [[ "$rw4" == *"$1"* ]]; }
check "epic-wave section 4: a red Check goes to a fresh implementer" \
    in_rw4 'failure`: the PR is not merged and goes to a rework round (section 3, a fresh implementer) with that report'
check "epic-wave section 4: the culprit of a red set goes to a fresh implementer" \
    in_rw4 'the culprit goes to a rework round (section 3, a fresh implementer) with the log of its run'
check "epic-wave section 4: no rework goes back to its implementer" \
    lacks "$EW" 'back to its implementer as a rework round'
check "implementer: a rework round starts in its isolation-worktree tree and never calls EnterWorktree" \
    in_flat "$(cat "$IM")" 'the orchestrator launches you with `isolation: "worktree"`: your working directory is already a fresh tree of your own, the previous round'"'"'s tree is removed. Never call `EnterWorktree` — it refuses a subagent started at the repository root, by `path` and by `name` — and do not create another tree.'
check "implementer: a rework round checks a pushed branch out from origin in its tree" \
    in_flat "$(cat "$IM")" 'Check out the branch in your tree. Pushed (`pr-green-ci`) — from origin: `git checkout -B <branch> origin/<branch>`.'
check "implementer: a local-green / no-origin rework round checks out the local branch" \
    in_flat "$(cat "$IM")" 'With `local-green` or without `origin` nothing is pushed: check out the local branch, `git checkout <branch>` (worktrees share the branches; the orchestrator kept it).'
check "implementer: the old wording — always from origin — is gone" \
    lacks "$IM" 'Check out the branch from origin in your tree'
check "implementer: a local-green rework round names the head in its report and does not push" \
    in_flat "$(cat "$IM")" 'in your PR comment (`local-green`: in your report). Fix the `Findings` (details in `Verifier report`), push to the same PR (`local-green`: no push).'
check "implementer: a refused Edit is never written around" \
    in_flat "$(cat "$IM")" 'An Edit or Write that is refused is never written around (python, sed or a heredoc in Bash): stop and report it.'
check "implementer: the old rework wording — no EnterWorktree, edit by absolute paths — is gone" \
    bash -c '[[ "$1" != *"do not call \`EnterWorktree\` (refused from the repository root)"* && "$1" != *"edit files by absolute paths inside that tree"* ]]' _ "$(flat "$(cat "$IM")")"
check "implementer: a rework round skips claim and base, rebases first and names the rebased head" \
    in_flat "$(cat "$IM")" 'Skip steps 1–2 of the ticket skill (claim, base): rebase onto the base first — `Head` is from before it — and name the head after that rebase in your PR comment'
check "implementer: the create-a-tree rule points a rework round at the brief's tree" \
    in_flat "$(cat "$IM")" '(a rework round starts in the fresh tree it was launched in and skips this step, see "A rework round")'
check "implementer: a rework round is not sent into EnterWorktree" \
    lacks "$IM" 'enter that tree (`EnterWorktree`'
# In Silent mode the verdict is the last gate: line of the ticket file, not its last line: group lines follow
# the verdict of their round with VERIFIED too, and the verdict is read with grep | tail.
ew3="$(section "$EW" 3 | tr '\n' ' ' | tr -s ' ')"
check "epic-wave section 3: Silent mode — the verdict is the last line that starts with gate: but MAX-REVIEW, not the last line" \
    bash -c '[[ "$1" == *"$2"* ]]' _ "$ew3" \
    "In Silent mode the ticket's verdict is the last line of the ticket file that starts with \`gate:\`, except the \`gate: MAX-REVIEW: …\` line (section 4), not the last line of the file: \`gate: VERIFIED — <date>\`, or after the narrow round \`gate: NARROW: VERIFIED\` or \`gate: NARROW: REJECTED: …\`."
check "epic-wave section 3: Silent mode — group lines follow the verdict line with VERIFIED too" \
    bash -c '[[ "$1" == *"$2"* ]]' _ "$ew3" \
    'The group lines (below) follow the verdict line of their round with `VERIFIED` too, and the result section goes on below them.'
check "epic-wave section 3: Silent mode — the verdict is read as the last gate: line past MAX-REVIEW" \
    bash -c '[[ "$1" == *"$2"* ]]' _ "$ew3" \
    "Read the verdict with \`grep '^gate:' <ticket file> | grep -v '^gate: MAX-REVIEW:' | tail -n 1\`."
# The wave's report (section 5) shows the groups between the table and the status block.
check "epic-wave section 5: the report shows the four groups, the status block stays last" \
    bash -c '[[ "$1" == *"$2"* ]]' _ "$(section "$EW" 5 | tr '\n' ' ' | tr -s ' ')" \
    'A table for the wave, then the four groups of findings of every ticket whose gate gave any (section 3: Act on, Consider, Noted, Dismissed, an empty group as "none"), then the four-line status block, which stays last.'

# 7e. Two machines on one repository: the open PRs
# of other epics before a wave, BEHIND rebased, the Windows step of the manual GUI checks, and the cross-machine
# gate — the label, the checks section, the report before the merge, gate full on the fresh base on `request`.
# The names of the label and of the section come from the profile, never from the text.
ew1="$(section "$EW" 1 | tr '\n' ' ' | tr -s ' ')"; ew4="$(section "$EW" 4 | tr '\n' ' ' | tr -s ' ')"
st6="$(section "$ST" 6 | tr '\n' ' ' | tr -s ' ')"; st8="$(section "$ST" 8 | tr '\n' ' ' | tr -s ' ')"; st9="$(section "$ST" 9 | tr '\n' ' ' | tr -s ' ')"
in_() { [[ "$1" == *"$2"* ]]; }
before() { local a="${1%%"$2"*}" b="${1%%"$3"*}"; [[ "$1" == *"$2"* && "$1" == *"$3"* ]] && [ ${#a} -lt ${#b} ]; }   # before <text> <first> <second>
check "epic-wave section 1: the open-PR block takes number,headRefName,files and filters with --jq" \
    in_ "$ew1" '--json number,headRefName,files \ --jq ".[] | select('
check "epic-wave section 1: the open-PR block is in section 1" in_ "$ew1" 'gh pr list --state open --limit 200 --json number,headRefName,files'
check "epic-wave section 1: a ticket sharing a file is not dispatched until that PR is merged" in_ "$ew1" 'is **not dispatched until that PR is merged**'
check "epic-wave section 1: the plan and the report name the ticket, the file and the PR" in_ "$ew1" 'The plan table and the wave report name the ticket, the file and the PR number.'
check "epic-wave section 4: BEHIND is rebased onto the fresh base, pushed, and CI runs again" in_ "$ew4" \
    'Rebase the branch onto the fresh base in the ticket'"'"'s worktree and push it with a lease on the head the PR had before the rebase'
check "epic-wave section 4: the BEHIND push holds a lease on the PR's head" in_ "$ew4" \
    '`git push --force-with-lease=<branch>:<headRefOid> origin HEAD:<branch>`, `<headRefOid>` from `gh pr view <N> --json headRefOid`'
check "epic-wave section 4: CI again after the BEHIND push" in_ "$ew4" 'then wait for CI again with the CI wait block below'
check "epic-wave section 4: BEHIND no longer means only wait" in_ "$ew4" '`BEHIND` no longer means only "wait".'
check "epic-wave section 4: git fetch before each merge" in_ "$ew4" 'Before each merge run `git -C <repo> fetch`.'
check "epic-wave section 4: the main-branch lock is seen only on its own machine" in_ "$ew4" 'The lock is seen only on its own machine'
check "epic-wave section 4: the main-branch lock is at the repository's shared path, as gate-queue's" in_ "$ew4" 'L="$(git -C <repo> rev-parse --path-format=absolute --git-common-dir)/main.lock"'
check "epic-wave section 4: no BEHIND among the states that only wait" lacks "$EW" 'BLOCKED, UNSTABLE, BEHIND — wait'
check "ship-ticket section 6: the Windows paragraph launches through explorer.exe" in_ "$st6" 'explorer.exe "$(cygpath -w <path to the .exe>)"'
check "ship-ticket section 6: the Windows paragraph checks the process path with Get-Process" in_ "$st6" \
    '`powershell -NoProfile -Command "(Get-Process -Id <pid>).Path"`'
check "ship-ticket section 6: the agent's environment on Windows is named" in_ "$st6" 'NoDefaultCurrentDirectoryInExePath=1'
# The label. With serve, section 1 runs skill gate-queue: the pass is written only there, and
# section 1 keeps no copy of it (section 4 still has its own BEHIND rebase with --force-with-lease; not looked at here).
check "epic-wave section 1: cross_machine_gate" in_ "$ew1" cross_machine_gate
check "epic-wave section 1: with serve, /worfy:gate-queue before the preflight" in_ "$ew1" 'With `serve` — before the preflight, run skill `/worfy:gate-queue`'
check "epic-wave section 1: the gate queue before the preflight" before "$ew1" '/worfy:gate-queue' 'bin/preflight" --epic <epic>'
check "epic-wave section 1: the gate queue's table goes into the wave report" in_ "$ew1" 'Its table goes into the wave report (section 5)'
for w in --force-with-lease --remove-label 'report: green' 'gh pr merge' 'isCrossRepository'; do
    check "epic-wave section 1: no serve pass block left ('$w')" bash -c '[[ "$1" != *"$2"* ]]' _ "$ew1" "$w"
done
check "epic-wave section 1: request — a merged PR closes its ticket" in_ "$ew1" '`MERGED` — the ticket is closed by skill `/worfy:ship-ticket`, step 11'
check "epic-wave section 1: request — a red report newer than the push sends the ticket back to work" in_ "$ew1" \
    'A red report newer than the last push (`report.at` later than `pushed`) — the ticket is back in work: `"${CLAUDE_PLUGIN_ROOT}/bin/ticket" open <epic> <NN>`'
check "epic-wave section 1: request — the branch is taken from origin anew" in_ "$ew1" 'Its branch is taken from origin anew'
check "epic-wave section 4: with request a labelled PR is not merged here" in_ "$ew4" \
    'With `F cross_machine_gate.role` `request` a PR with the label `F cross_machine_gate.label` is not merged on this machine'
check "ship-ticket section 8: --add-label" in_ "$st8" '--add-label "$(F cross_machine_gate.label)"'
check "ship-ticket section 9: a labelled PR is not merged by this machine" in_ "$st9" \
    'With `F cross_machine_gate.role` `request` a PR with the label `F cross_machine_gate.label` is not merged by this machine'
# The checks section and the report (Q33) are in skills/gate-queue (gate-queue.test.sh); gate full on the fresh base (Q31).
check "epic-wave section 1: request — the report is looked up by the checks section" in_ "$ew1" 'sec=$(F cross_machine_gate.checks_section)'
check "epic-wave section 1: request — gate full on the fresh base in a detached worktree, before the dispatch" in_ "$ew1" \
    'With `request` — first a gate full on the fresh base, before any ticket is dispatched'
check "epic-wave section 1: request — the worktree of the base is detached" in_ "$ew1" 'worktree add --detach <scratchpad>/base-gate "$B"'
# worktree.base is already a remote branch (origin/main): origin/<base> would name origin/origin/main.
for f in "$EW" "$ST"; do
    check "$(name_of "$f"): no origin/<base>" lacks "$f" 'origin/<base>'
done
check "epic-wave section 4: the BEHIND rebase is for PRs merged outside wave-gate" in_ "$ew4" \
    'A PR merged outside `wave-gate` (with `"each"`, or one out of the set) in state `BEHIND`'
check "epic-wave section 4: the PRs of a wave-gate set are not rebased" in_ "$ew4" 'PRs of a `wave-gate` set are not rebased'
check "epic-wave section 1: request — fix the base first" in_ "$ew1" 'Red — **fix the base first**'
check "epic-wave section 1: the cross-machine gate comes before the preflight" before "$ew1" 'The cross-machine gate comes first' 'bin/preflight" --epic <epic>'
for w in checks_section --body-file '`none`'; do
    check "ship-ticket section 8: the label block has '$w'" in_ "$st8" "$w"
done
for f in "$EW" "$ST"; do
    n="$(name_of "$f")"
    check "$n: no label name in the text (it comes from the profile)" lacks "$f" 'needs-mac-gate'
    check "$n: no section name in the text (it comes from the profile)" lacks "$f" 'Mac checks'
done

# 8. Cyrillic only in allowed places: the old Autopilot forms, placeholders of profile values,
# section names of Project documents and Russian examples. The Gate verdict lines are English.
ALLOWED=(
    # The old Autopilot forms and the Russian request, which the skill still accepts.
    'Ticket-ы NN, NN эпика X' 'волна N эпика X' 'прогони волну N эпика X'
    # Section names of worfy's Project documents and examples of what an agent writes there.
    '## Где в коде' '## Итог' 'Готово, когда' 'Ждёт владельца' 'Волны'
    'решено без владельца, подтвердить' 'не проверено: …' 'узкий круг листовому Ticket-у — решение владельца'
)
for f in "$EW" "$ST"; do
    n="$(name_of "$f")"
    left="$(without "$f" "${ALLOWED[@]}" | perl -CSD -ne 'print "$.: $_" if /\p{Cyrillic}/' | head -n 5)"
    check "$n: no Cyrillic outside the allowlist${left:+ — first: $left}" test -z "$left"
done

# 9. The Pipeline: both skills read `_resolved.pipeline` and act on its
# Stages — Agent review where it stands, Check «<name>» as marks on the PR's head, people's Stages without a merge,
# Deploy before the ticket closes. The blocks run under bash and zsh with a stub profile, a stub gh that only
# reads (any write or unknown call is exit 1) and a temporary HOME and HARNESS_HOME.
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
. "$HARNESS/bin/tests/real-home.sh"
. "$HARNESS/bin/tests/gh-stand-in.sh"
# The shells every block of section 9 runs under. Git Bash on Windows has no zsh: there the zsh
# cases are skipped with one line. On macOS and Linux a missing zsh is a failure, not a skip.
SHELLS=(bash zsh)
if on_windows && ! command -v zsh >/dev/null 2>&1; then
    SHELLS=(bash); echo "skip zsh: Git Bash on Windows has no zsh, the zsh cases run on macOS and Linux"
fi
# Off Windows the zsh cases always run: a skip that fired there would leave them out and the file would stay green.
case "$(uname -s)" in
    MINGW* | MSYS*) ;;
    *) [[ " ${SHELLS[*]} " == *" zsh "* ]] && ok "the shells of the blocks include zsh off Windows" || bad "the shells of the blocks lack zsh off Windows: [${SHELLS[*]}]" ;;
esac
home_before="$(real_home_snapshot "$HOME" "$T")"
REAL_HOME="$HOME"
skill_block() { # skill_block <file> <marker>: the ```bash blocks of <file> that contain <marker>, without the F() line
    awk -v m="$2" '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,m)) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}' "$1" \
        | grep -v '^F() { "\${CLAUDE_PLUGIN_ROOT}/bin/profile"'
}
GHS="$T/gh-bin"; GH_DATA="$T/gh-data"; GH_LOG="$T/gh.log"; mkdir -p "$GHS" "$GH_DATA" "$T/home" "$T/hh"; : >"$GH_LOG"
cat >"$GHS/gh" <<'EOF'
#!/usr/bin/env bash
# A gh stand-in that only reads: the answers are files in $GH_DATA, filtered by --jq like gh does. A write
# (-X, --method, -f) or a call it does not know is exit 1. Every call goes to $GH_LOG.
printf '%s\n' "$*" >>"$GH_LOG"
jqf=; args=()
while [ $# -gt 0 ]; do
    case "$1" in --jq) jqf=$2; shift 2 ;; -X|--method|-f|-F|--field|--raw-field) echo "gh stand-in: no writes" >&2; exit 1 ;; *) args+=("$1"); shift ;; esac
done
p="${args[2]:-}"
case "${args[0]:-} ${args[1]:-}" in
    "pr view") f="$GH_DATA/pr-$p.json" ;;
    "api repos/{owner}/{repo}/commits/"*/status)
        f="$GH_DATA/status-$(sed -E 's#^.*/commits/([^/]+)/status$#\1#' <<<"${args[1]}").json"; [ -f "$f" ] || f="$GH_DATA/no-status.json" ;;
    "api repos/{owner}/{repo}/deployments?"*) f="$GH_DATA/deployments.json" ;;
    "api repos/{owner}/{repo}/deployments/"*/statuses)
        f="$GH_DATA/deployment-$(sed -E 's#^.*/deployments/([^/]+)/statuses$#\1#' <<<"${args[1]}").json" ;;
    *) echo "gh stand-in: unknown call: ${args[*]}" >&2; exit 1 ;;
esac
[ -f "$f" ] || { echo "gh stand-in: no answer for: ${args[*]}" >&2; exit 1; }
# jq for Windows ends its lines with CRLF; gh itself prints LF.
if [ -n "$jqf" ]; then jq -rc "$jqf" "$f" | tr -d '\r'; exit "${PIPESTATUS[0]}"; else cat "$f"; fi
EOF
chmod +x "$GHS/gh"; refusing_gh_exe "$GHS/gh"
echo '{"statuses":[]}' >"$GH_DATA/no-status.json"
( PATH="$GHS:$PATH"; gh_guard - "$GHS/gh" - ) || exit 1
RUN_ENV=(env HOME="$T/home" HARNESS_HOME="$(node_path "$T/hh")" PATH="$GHS:$PATH" GH_LOG="$GH_LOG" GH_DATA="$GH_DATA" GH_TOKEN=worfy-test-no-token GH_CONFIG_DIR="$T/gh-config")
mkdir -p "$T/gh-config"

# 9a. Both skills read the Pipeline with the same block, near the top (ship-ticket section 0, epic-wave section 0).
PL_MARK='--field _resolved.pipeline | node -e'
PL_EW="$(skill_block "$EW" "$PL_MARK")"; PL_ST="$(skill_block "$ST" "$PL_MARK")"
check "Pipeline: epic-wave section 0 reads _resolved.pipeline" bash -c '[[ "$1" == *"$2"* ]]' _ "$(section "$EW" 0)" "$PL_MARK"
check "Pipeline: ship-ticket section 0 reads _resolved.pipeline" bash -c '[[ "$1" == *"$2"* ]]' _ "$(section "$ST" 0)" "$PL_MARK"
check "Pipeline: one block in both skills" bash -c '[ -n "$1" ] && [ "$1" = "$2" ]' _ "$PL_EW" "$PL_ST"
mkdir -p "$T/plugin/bin"
cat >"$T/plugin/bin/profile" <<'EOF'
#!/usr/bin/env bash
# bin/profile stand-in: prints $PIPELINE for --field _resolved.pipeline, exit $PROFILE_EXIT otherwise.
[ "${PROFILE_EXIT:-0}" = 0 ] || { echo "profile: broken" >&2; exit "$PROFILE_EXIT"; }
[ "$1 $2 $3 $4" = "-C $REPO_WANT --field _resolved.pipeline" ] || { echo "profile stand-in: $*" >&2; exit 2; }
printf '%s\n' "$PIPELINE"
EOF
chmod +x "$T/plugin/bin/profile"
WORFY_PL='[{"kind":"queued"},{"kind":"implementing"},{"kind":"ci"},{"kind":"agent-review"},{"kind":"check","name":"windows"},{"kind":"gate-merge"},{"kind":"deploy"},{"kind":"closing"},{"kind":"done"}]'
for sh in "${SHELLS[@]}"; do
    got="$("${RUN_ENV[@]}" CLAUDE_PLUGIN_ROOT="$T/plugin" REPO_WANT=/r PIPELINE="$WORFY_PL" $sh -c "${PL_EW//<repo>//r}" 2>&1)"
    check "$sh: the Pipeline block prints one Stage per line, a Check with its name" test "$got" = 'queued
implementing
ci
agent-review
check windows
gate-merge
deploy
closing
done
EXIT=0'
    got="$("${RUN_ENV[@]}" CLAUDE_PLUGIN_ROOT="$T/plugin" REPO_WANT=/r PROFILE_EXIT=1 $sh -c "${PL_EW//<repo>//r}" 2>&1)"
    check "$sh: the Pipeline block with a broken profile ends in a non-zero EXIT" bash -c '[[ "$1" == *"EXIT="[1-9]* ]] && [[ "$1" != *"EXIT=0"* ]]' _ "$got"
done

# 9b. Check «<name>»: the marks on the head of each ready PR decide whether it goes into the set.
CB="$(skill_block "$EW" 'CANDIDATES=(')"
check "Check: the block of marks on the PR heads is in epic-wave section 4" bash -c '[ -n "$1" ] && [[ "$2" == *"CANDIDATES=("* ]]' _ "$CB" "$(section "$EW" 4)"
check "Check: the block of marks does not take the set block's place (wave-gate.test.sh finds that one by PLATFORM=()" \
    bash -c '[[ "$1" != *"PLATFORM=("* ]]' _ "$CB"
sha() { printf '%040d' "$1"; }                # a fake 40-character SHA
pr_head() { printf '{"headRefOid":"%s"}\n' "$(sha "$2")" >"$GH_DATA/pr-$1.json"; }
statuses() { # statuses <sha number> <context:state:description>...
    local s="$1" out="" c; shift
    for c in "$@"; do IFS=: read -r ctx state desc <<<"$c"; out="$out${out:+,}{\"context\":\"$ctx\",\"state\":\"$state\",\"description\":\"$desc\"}"; done
    printf '{"statuses":[%s]}\n' "$out" >"$GH_DATA/status-$(sha "$s").json"
}
run_checks() { # run_checks <sh> <mode> <pipeline JSON> <candidates> [<workflow.finish>]: the block in the repository $R
    local b="${CB//<repo>/$R}" fin="return 4"
    [ -z "${5:-}" ] || fin="echo $5"
    b="${b//<epic>/pay-flow}"; b="${b//<PR>:<NN> pairs in merge order/$4}"
    (cd "$R" && "${RUN_ENV[@]}" $1 -c "F() { case \"\$1\" in _resolved.pipeline) printf '%s\n' '$3' ;; _resolved.mode) echo $2 ;; _resolved.name) echo sp ;; workflow.finish) $fin ;; *) return 4 ;; esac; }"$'\n'"$b" 2>&1)
}
R="$T/repo"; git init -q -b main "$R"
RO="$T/repo-origin"; git init -q -b main "$RO"; git -C "$RO" remote add origin "$T/pay.git"   # any origin: the rule asks only whether there is one
pr_head 1 11; pr_head 2 12; pr_head 3 13; pr_head 4 14; pr_head 5 15; pr_head 6 16
statuses 12 'check/windows:success:skipped' 'review:success:success'
statuses 13 'check/windows:success:success' 'review:success:success'
statuses 14 'check/windows:failure:failure'
statuses 105 'check/windows:success:success'        # a mark on an old head of PR 5
statuses 16 'check/windows:pending:pending'
line() { grep "^PR $1 " <<<"$2"; }
for sh in "${SHELLS[@]}"; do
    : >"$GH_LOG"
    got="$(run_checks "$sh" full "$WORFY_PL" '1:01 2:02 3:03 4:04 5:05 6:06')"
    check "$sh: Check without a mark on the head — the PR waits, out of the set" bash -c '[[ "$1" == *"check/windows=none — waits" ]]' _ "$(line 1 "$got")"
    check "$sh: Check skipped — the PR is ready, not a platform PR" bash -c '[[ "$1" == *"check/windows=skipped — ready" ]]' _ "$(line 2 "$got")"
    check "$sh: Check success — the PR is ready and goes into PLATFORM" bash -c '[[ "$1" == *"check/windows=success — ready, PLATFORM" ]]' _ "$(line 3 "$got")"
    check "$sh: Check failure — the PR failed, it goes to rework" bash -c '[[ "$1" == *"check/windows=failure — failed" ]]' _ "$(line 4 "$got")"
    check "$sh: a mark on an old head does not count — the PR waits" bash -c '[[ "$1" == *"check/windows=none — waits" ]]' _ "$(line 5 "$got")"
    check "$sh: Check pending — the PR waits" bash -c '[[ "$1" == *"check/windows=pending — waits" ]]' _ "$(line 6 "$got")"
    check "$sh: the line names the PR's head" bash -c '[[ "$1" == "PR 2 $2 "* ]]' _ "$(line 2 "$got")" "$(sha 12 | cut -c1-7)"
    check "$sh: the block of marks ends in EXIT=0" bash -c '[ "$(tail -n 1 <<<"$1")" = EXIT=0 ]' _ "$got"
    check "$sh: Full mode reads the commit status of each head, writes nothing" \
        bash -c '[ "$(grep -c "^api repos/{owner}/{repo}/commits/.*/status" "$1")" = 6 ] && ! grep -qE -- "-X|--method|(^| )-f " "$1"' _ "$GH_LOG"
    got="$(run_checks "$sh" full '[{"kind":"queued"},{"kind":"ci"},{"kind":"agent-review"},{"kind":"gate-merge"},{"kind":"done"}]' '1:01 4:04')"
    NOCHECK="no Check in the Pipeline — ready (PLATFORM if the project's rules make it a platform PR)"
    check "$sh: no Check in the Pipeline — every PR is ready, the line sends platform PRs to the project's rules" \
        bash -c '[[ "$(grep "^PR 1 " <<<"$1")" == *"$2" ]] && [[ "$(grep "^PR 4 " <<<"$1")" == *"$2" ]]' _ "$got" "$NOCHECK"
    TWO='[{"kind":"queued"},{"kind":"check","name":"windows"},{"kind":"check","name":"linux"},{"kind":"gate-merge"},{"kind":"done"}]'
    got="$(run_checks "$sh" full "$TWO" '2:02')"
    check "$sh: two Checks, one without a mark — the PR waits" bash -c '[[ "$1" == *"check/windows=skipped check/linux=none — waits" ]]' _ "$(line 2 "$got")"
    # Silent mode: the marks file of the ticket in $HARNESS_HOME, the last mark of a kind on the head wins; no status read.
    mkdir -p "$T/hh/runs/sp/marks"
    printf '{"epic":"pay-flow","num":"02","marks":[{"kind":"check/windows","verdict":"pending","sha":"%s","at":"t1"},{"kind":"check/windows","verdict":"skipped","sha":"%s","at":"t2"},{"kind":"check/windows","verdict":"failure","sha":"%s","at":"t3"}]}\n' \
        "$(sha 12)" "$(sha 12)" "$(sha 99)" >"$T/hh/runs/sp/marks/pay-flow-02.json"
    : >"$GH_LOG"
    got="$(run_checks "$sh" silent "$WORFY_PL" '2:02 3:03')"
    check "$sh: Silent mode — the marks file: skipped on the head, a failure on another commit does not count" bash -c '[[ "$1" == *"check/windows=skipped — ready" ]]' _ "$(line 2 "$got")"
    check "$sh: Silent mode — no marks file for the ticket: the PR waits" bash -c '[[ "$1" == *"check/windows=none — waits" ]]' _ "$(line 3 "$got")"
    check "$sh: Silent mode — no commit status is read" bash -c '! grep -q "^api " "$1"' _ "$GH_LOG"
    # Full mode with local-green: the same marks file when the repository has no origin ($R), as ticket mark writes
    # it; with an origin, or with another finish, the commit statuses (one read per PR).
    : >"$GH_LOG"
    got="$(run_checks "$sh" full "$WORFY_PL" '2:02 3:03' local-green)"
    check "$sh: Full + local-green, no origin — the marks file: skipped on the head, a failure on another commit does not count" bash -c '[[ "$1" == *"check/windows=skipped — ready" ]]' _ "$(line 2 "$got")"
    check "$sh: Full + local-green, no origin — no marks file for the ticket: the PR waits" bash -c '[[ "$1" == *"check/windows=none — waits" ]]' _ "$(line 3 "$got")"
    check "$sh: Full + local-green, no origin — no commit status is read" bash -c '! grep -q "^api " "$1"' _ "$GH_LOG"
    : >"$GH_LOG"
    got="$(run_checks "$sh" full "$WORFY_PL" '3:03' pr-green-ci)"
    check "$sh: Full + pr-green-ci, no origin — the commit statuses, not the marks file" \
        bash -c '[[ "$1" == *"check/windows=success — ready, PLATFORM" ]] && [ "$(grep -c "^api repos/{owner}/{repo}/commits/.*/status" "$2")" = 1 ]' _ "$(line 3 "$got")" "$GH_LOG"
    : >"$GH_LOG"
    got="$(R="$RO" run_checks "$sh" full "$WORFY_PL" '3:03' local-green)"
    check "$sh: Full + local-green with an origin — the commit statuses, not the marks file" \
        bash -c '[[ "$1" == *"check/windows=success — ready, PLATFORM" ]] && [ "$(grep -c "^api repos/{owner}/{repo}/commits/.*/status" "$2")" = 1 ]' _ "$(line 3 "$got")" "$GH_LOG"
    rm -rf "$T/hh/runs"
    got="$(run_checks "$sh" full "$WORFY_PL" '7:07 2:02')"
    check "$sh: gh gives no head — the line says so, the other PRs still get theirs, EXIT=1" \
        bash -c '[[ "$1" == *"PR 7: no head from gh"* ]] && [[ "$1" == *"check/windows=skipped — ready"* ]] && [ "$(tail -n 1 <<<"$1")" = EXIT=1 ]' _ "$got"
done
EW4="$(section "$EW" 4 | tr '\n' ' ' | tr -s ' ')"
in_ew4() { [[ "$EW4" == *"$1"* ]]; }
check "Check: the mark is set with ticket mark on the head SHA" has "$EW" '"${CLAUDE_PLUGIN_ROOT}/bin/ticket" mark <epic> <NN> check/<name> skipped --sha "$sha"'
check "Check: the set takes only the ready PRs" in_ew4 'Only the PRs whose line says `ready` — `ready` or `ready, PLATFORM` — go into `PRS=(…)` of a set'
check "Check: PLATFORM=() is filled from the PRs whose Check is not skipped" in_ew4 'the `ready, PLATFORM` ones go into its `PLATFORM=(…)` too'
check "Check: a push or a rebase leaves the marks on the old head" in_ew4 'after a push or a rebase the new head has no marks, and the PR waits again'
check "Check: which PRs need a Check is the project's rule" in_ew4 'the project'"'"'s rules (`rules.md`) say the PR does not need this check'
# Without a `check` Stage (the default Pipeline, a profile not yet edited) the rule in words stays: platform PRs
# keep out of the set, go into PLATFORM=() and merge the old way after the other platform's verdict.
check "Check: no Check in the Pipeline — PLATFORM=() lists the platform PRs by the project's rules" \
    in_ew4 '**With no `check` Stage in the Pipeline** the marks cannot tell them, and the rule in words stays: `PLATFORM=(…)` lists the platform PRs — those the project'"'"'s rules send to another platform'"'"'s verdict — and each of them merges the old way only after that verdict on its head'
check "Check: no Check in the Pipeline — a platform PR merged the old way waits for the other platform's verdict" \
    in_ew4 "(with no \`check\` Stage — plus the other platform's verdict for a platform PR)"
check "Check: epic-wave section 0 keeps platform PRs waiting without a check Stage" \
    bash -c '[[ "$1" == *"$2"* ]]' _ "$(section "$EW" 0 | tr '\n' ' ' | tr -s ' ')" \
    "With no \`check\` Stage in the Pipeline the platform PRs still wait: those the project's rules send to another platform's verdict go into \`PLATFORM=(…)\` and merge the old way after that verdict"
check "Check: ship-ticket step 9 keeps platform PRs waiting without a check Stage" \
    bash -c '[[ "$1" == *"$2"* ]]' _ "$(section "$ST" 9 | tr '\n' ' ' | tr -s ' ')" \
    "With no \`check\` Stage in the Pipeline a platform PR — one the project's rules send to another platform's verdict — merges only after that verdict, the old way"

# 9c. Agent review where the Pipeline puts it; people's Stages are not merged; Deploy before the ticket closes.
EW0="$(section "$EW" 0 | tr '\n' ' ' | tr -s ' ')"; ST0="$(section "$ST" 0 | tr '\n' ' ' | tr -s ' ')"
in_ew0() { [[ "$EW0" == *"$1"* ]]; }
in_st0() { [[ "$ST0" == *"$1"* ]]; }
check "epic-wave: Agent review before CI — no PR until review success" in_ew0 'after `review success` the orchestrator asks the implementer through `SendMessage` to open the PR from that same head'
check "epic-wave: no Agent review in the Pipeline — no review by agents" in_ew0 'No `agent-review` in the Pipeline — no review by agents: section 3 is skipped'
check "epic-wave: Human review — no merge before APPROVED" in_ew0 'With `human-review` the wave does not merge a PR before its review decision is `APPROVED`'
check "epic-wave: Awaiting merge — the wave never merges, the ticket waits for people" in_ew0 'with `awaiting-merge` it never merges: people do. Such a ticket stays `claimed` with its PR open, the wave goes on without it'
check "epic-wave: Deploy — the ticket is not closed before its deploy" in_ew0 'after the merge the ticket is not closed (`ticket done`) until its merge commit is deployed'
check "epic-wave section 3 runs only with agent-review in the Pipeline" bash -c '[[ "$1" == *"Only with \`agent-review\` in the Pipeline"* ]]' _ "$(section "$EW" 3 | tr '\n' ' ' | tr -s ' ')"
check "ship-ticket: steps 7 and 8 go in the Pipeline's order" in_st0 'Steps 7 and 8 go in the order of the Pipeline'
check "ship-ticket: no Agent review in the Pipeline — step 7 is skipped" in_st0 'no `agent-review` in the Pipeline — step 7 is skipped'
check "ship-ticket step 9: Checks, people and the merge" bash -c '[[ "$1" == *"Checks before merge"* ]] && [[ "$1" == *"\`awaiting-merge\`"* ]] && [[ "$1" == *"\`human-review\`"* ]]' _ "$(section "$ST" 9 | tr '\n' ' ' | tr -s ' ')"
check "ship-ticket step 11: no ticket done before the deploy" bash -c '[[ "$1" == *"Deploy before close"* ]] && [[ "$1" == *"DEPLOYED=none"* ]]' _ "$(section "$ST" 11 | tr '\n' ' ' | tr -s ' ')"
check "epic-wave item 4: ticket done only for a deployed ticket" in_ew4 '`DEPLOYED=none` — not yet: the ticket stays `claimed`'

# 9d. The deploy block: the merge commit is an ancestor of a commit with the deploy mark.
DB="$(skill_block "$EW" 'DEPLOYED=')"
check "Deploy: the block is in epic-wave section 4" bash -c '[ -n "$1" ] && [[ "$2" == *"DEPLOYED="* ]]' _ "$DB" "$(section "$EW" 4)"
O="$T/origin.git"; git init -q --bare -b main "$O"
D="$T/deploy-repo"; git init -q -b main "$D"; git -C "$D" remote add origin "$O"
for i in 1 2 3 4; do echo "$i" >"$D/f"; git -C "$D" add f; git -C "$D" -c user.email=t@t -c user.name=t commit -q -m "c$i"; done
git -C "$D" push -q origin main
c() { git -C "$D" rev-parse "HEAD~$((4 - $1))"; }           # c 1 … c 4, c 2 is the merge commit
printf '{"mergeCommit":{"oid":"%s"}}\n' "$(c 2)" >"$GH_DATA/pr-42.json"
run_deploy() { # run_deploy <sh> <pipeline JSON>
    local b="${DB//<repo>/$D}"; b="${b//<main branch>/main}"; b="${b//<N>/42}"
    (cd "$D" && "${RUN_ENV[@]}" $1 -c "F() { case \"\$1\" in _resolved.pipeline) printf '%s\n' '$2' ;; *) return 4 ;; esac; }"$'\n'"$b" 2>&1)
}
st_file() { printf '{"statuses":[%s]}\n' "$2" >"$GH_DATA/status-$1.json"; }
NOENV="$WORFY_PL"
ENV_PL='[{"kind":"queued"},{"kind":"gate-merge"},{"kind":"deploy","environment":"stable"},{"kind":"done"}]'
for sh in "${SHELLS[@]}"; do
    rm -f "$GH_DATA"/status-*.json "$GH_DATA"/deployment*.json
    st_file "$(c 3)" '{"context":"deploy","state":"success","description":"installed"}'
    got="$(run_deploy "$sh" "$NOENV")"
    check "$sh: deploy mark on a later commit of the main branch — DEPLOYED is that commit" bash -c '[[ "$1" == *"DEPLOYED=$2"* ]]' _ "$got" "$(c 3)"
    rm -f "$GH_DATA"/status-*.json
    st_file "$(c 1)" '{"context":"deploy","state":"success","description":"installed"}'
    st_file "$(c 4)" '{"context":"deploy","state":"failure","description":"x"},{"context":"review","state":"success","description":"success"}'
    got="$(run_deploy "$sh" "$NOENV")"
    check "$sh: deploy mark only before the merge, a failed one after it — DEPLOYED=none" bash -c '[[ "$1" == *"DEPLOYED=none"* ]]' _ "$got"
    st_file "$(c 2)" '{"context":"deploy","state":"success","description":"installed"}'
    got="$(run_deploy "$sh" "$NOENV")"
    check "$sh: deploy mark on the merge commit itself — deployed" bash -c '[[ "$1" == *"DEPLOYED=$2"* ]]' _ "$got" "$(c 2)"
    # With an environment: a GitHub Deployment, the newest first; one that does not contain the merge commit does not count.
    rm -f "$GH_DATA"/status-*.json
    printf '[{"id":9,"sha":"%s"},{"id":8,"sha":"%s"}]\n' "$(c 1)" "$(c 4)" >"$GH_DATA/deployments.json"
    echo '[{"state":"success"}]' >"$GH_DATA/deployment-9.json"; echo '[{"state":"failure"},{"state":"success"}]' >"$GH_DATA/deployment-8.json"
    : >"$GH_LOG"
    got="$(run_deploy "$sh" "$ENV_PL")"
    check "$sh: a Deployment whose latest status is not success — DEPLOYED=none" bash -c '[[ "$1" == *"DEPLOYED=none"* ]]' _ "$got"
    check "$sh: the Deployments are asked for by the Stage's environment" grep -q 'deployments?environment=stable' "$GH_LOG"
    echo '[{"state":"success"}]' >"$GH_DATA/deployment-8.json"
    got="$(run_deploy "$sh" "$ENV_PL")"
    check "$sh: a successful Deployment of a commit that contains the merge — deployed" bash -c '[[ "$1" == *"DEPLOYED=$2"* ]]' _ "$got" "$(c 4)"
done
# 9e. The agents mode: workflow.agents is "eco" or "full", no field is "full". eco starts fewer subagents
# per ticket (a small ticket without an implementer, the scout only on unknown code, one reviewer at low
# depth); full stays required for scripts, hooks, platform PRs and destructive diffs; the reports name the
# mode and the number of subagents. The draft schema takes eco, full, null and no field, and refuses the rest.
lacks_re_text() { [[ "$(flat "$1")" != *"$2"* ]]; } # $1 = text, $2 = literal string it must not carry
ew1="$(awk '/^## 1\./{p=1; next} /^## /{p=0} p' "$EW")"; ew2="$(awk '/^## 2\./{p=1; next} /^## /{p=0} p' "$EW")"
ew5="$(awk '/^## 5\./{p=1; next} /^## /{p=0} p' "$EW")"; st7="$(awk '/^## 7\./{p=1; next} /^## /{p=0} p' "$ST")"
RD="$HARNESS/profiles/README.md"; rd="$(cat "$RD")"
NOFIELD='No field (exit 4 or `null`) — `full`: the agents as before. Any other value is read as `full`, with the reason `workflow.agents`.'
# The cases where full is required: the same words in both skills; only the pointer to the depth scale differs
# (epic-wave points at ship-ticket step 7, ship-ticket at its own paragraph "What blocks", not at itself).
FULL='`full` is required in `eco` too when the change touches a script or a hook (the `bin/` or `hooks/` of the Harness, or a script of the repository), when it is a platform PR (one that needs the verdict of another operating system by the `rules.md` of the project), or when its diff deletes files, stops processes or replaces a copy (the cases that block a merge by the review depth scale'
FULL_EW="$FULL"', `/worfy:ship-ticket`, step 7).'
FULL_ST="$FULL"', paragraph "What blocks" below).'
AGENTS='The report names the mode of the ticket: `Agents: eco` or `Agents: full — <reason>`, where `<reason>` is `workflow.agents`, `default: the profile has no workflow.agents`, or the case of the list above that applies (`script or hook`, `platform PR`, `destructive action`).'
SUBAGENTS='`Subagents: <number> — <names>`: every subagent started for the ticket counts — the scout, the implementers, the verifier, the reviewers and the sceptics.'
check "README: a row for workflow.agents with eco, full and null" grep -qF '| `workflow.agents` | `"eco"` \| `"full"` \| null |' "$RD"
check "README: no workflow.agents — full, as before" in_flat "$rd" 'absent or `null` — `full`, the agents as before'
check "README: the skills describe the mode" in_flat "$rd" 'what `eco` changes is described in skill `epic-wave`, section 1, and skill `ship-ticket`, step 7'
check "README: any other value of workflow.agents is read as full" in_flat "$rd" 'another value — the draft schema refuses it, and the skills read it as `full`'
# review.depth.first_round and review.depth.later_rounds: eco overrides them for a ticket's own diff, like an argument.
EWORD='An argument of the skill, the owner'"'"'s word in a message or `workflow.agents` `"eco"` (`low` depth for the review of a ticket'"'"'s own diff) overrides it.'
for fld in first_round later_rounds; do
    check "README: review.depth.$fld — eco overrides it, like an argument" bash -c 'grep -F "| \`review.depth.$1\` |" "$2" | grep -qF -- "$3"' _ "$fld" "$RD" "$EWORD"
done
check "README: no depth row says only the argument or the owner's word overrides it" lacks "$RD" 'An argument of the skill or the owner'"'"'s word in a message overrides it.'
for f in "$EW" "$ST"; do
    n="$(name_of "$f")"; if [ "$f" = "$EW" ]; then s="$ew1"; else s="$st7"; fi
    check "$n: reads F workflow.agents" in_flat "$s" '`F workflow.agents`'
    check "$n: no field — full" in_flat "$s" "$NOFIELD"
    if [ "$f" = "$EW" ]; then full="$FULL_EW"; else full="$FULL_ST"; fi
    check "$n: the cases where full is required, word for word" in_flat "$s" "$full"
    check "$n: the Agents line of the report" in_flat "$s" "$AGENTS"
    check "$n: the Subagents line of the report" in_flat "$s" "$SUBAGENTS"
done
check "epic-wave section 1: eco — the scout only on unknown code" in_flat "$ew1" \
    'With `eco` the scout goes only when no file the trail section names exists yet, or the ticket touches a folder that the trail section of no earlier ticket of the epic names; otherwise the orchestrator completes the list itself, reading the files at their `file:line`.'
check "epic-wave section 1: eco — a small ticket without an implementer, the verifier stays" in_flat "$ew1" \
    'With `eco` a small ticket — only documents, or one change in one file of its trail section — gets no implementer: the orchestrator does it itself (section 2), and the verifier checks it like any other ticket (section 3).'
check "epic-wave section 1: the mode is checked again on the diff of a small ticket" in_flat "$ew1" \
    'The orchestrator decides the mode per ticket in the preflight, by its trail section, and checks it again on the diff of a small ticket it did itself (section 2).'
check "epic-wave section 2: the orchestrator does a small eco ticket itself" in_flat "$ew2" \
    'A small ticket in `eco` (section 1) gets no implementer: the orchestrator does it itself, in a worktree of its own by `F worktree.implementer`, by the steps `F workflow.implementer_steps`, and gives the verifier the fields of an implementer'"'"'s report (commands with exit codes, claims, what was removed). Its row of the plan names `orchestrator` in the "Who" column.'
check "epic-wave section 2: the orchestrator enters the worktree of a small ticket" in_flat "$ew2" \
    'Right after `git worktree add` the orchestrator enters that worktree with `EnterWorktree` (the `path` of the worktree): the PreToolUse check on Edit and Write lets edits only into the session'"'"'s worktree.'
SMALL_CHECK='Before any push or PR — after its local checks and a local commit — the orchestrator checks the diff of the small ticket against the cases where `full` is required (section 1).'
SMALL_GO='No match: it goes on to the finish `F workflow.finish`, returns with `ExitWorktree` (`action: "keep"`) and starts the verifier; the worktree stays for the gate and the merge.'
SMALL_HAND='On a match nothing is pushed and no PR is opened: the orchestrator returns with `ExitWorktree` (`action: "keep"`), and the ticket goes to an implementer the way a rework round does (section 3): `git worktree remove <worktree>` only, the local branch stays, the agent starts with `isolation: "worktree"`, and its brief is the rework brief with `Findings: none — a small ticket handed over: <the case>`, the line `PR: none — open it (ship-ticket, step 8)` (with `local-green`: `PR: none`), the line `Worktree: your launch tree (isolation "worktree") — git checkout <branch>` (the local branch, not pushed) and the line `Start from the orchestrator'"'"'s commit: review it, add the tests the change needs, run the checks and carry the ticket to its finish (push, PR, CI).`, never the `F worktree.implementer` template of the first brief.'
# The hand-off brief itself carries the promise; the old prose about the implementer outside the brief is gone.
SMALL_DONE='The report line of the ticket is `Agents: full — <the case>`, for example `Agents: full — destructive action`.'
check "epic-wave section 2: the promise is a line of the hand-off brief, not prose around it" lacks_re_text "$ew2" 'The implementer takes the orchestrator'"'"'s commit as its starting point'
check "epic-wave section 2: the diff of a small ticket is checked before any push or PR" in_flat "$ew2" "$SMALL_CHECK"
check "epic-wave section 2: no match — the finish, then the verifier" in_flat "$ew2" "$SMALL_GO"
check "epic-wave section 2: a match — no push, the rework way, the existing local branch, no worktree template" in_flat "$ew2" "$SMALL_HAND"
check "epic-wave section 2: what the implementer does with the orchestrator's commit" in_flat "$ew2" "$SMALL_DONE"
# The order inside the paragraph: the diff check, then the finish (no push or PR before the check).
before_finish() { local t; t="$(flat "$1")"; t="${t%%"$3"*}"; [[ "$t" == *"$2"* && "$(flat "$1")" == *"$3"* ]]; }
check "epic-wave section 2: the diff check comes before the finish of a small ticket" before_finish "$ew2" "$SMALL_CHECK" "$SMALL_GO"
check "epic-wave section 2: the hand-off brief does not move the base to the orchestrator's commit" lacks_re_text "$ew2" 'names the orchestrator'"'"'s commit in `Base:`'
check "epic-wave section 2: the small ticket does not go up to the finish before the check" lacks_re_text "$ew2" 'by the steps `F workflow.implementer_steps` up to the finish `F workflow.finish`, and gives the verifier'
check "epic-wave section 3: eco does not change the gate, the rework round or the narrow round" in_flat "$sec3" \
    'The agents mode does not change the gate: in `eco` the verifier stays, for a ticket the orchestrator did itself too, and the rework round and the narrow round go as described here.'
check "epic-wave section 5: the agents line and the subagent count of every ticket" in_flat "$ew5" \
    'for every ticket of the table, its agents line and the number of subagents started for it (section 1)'
check "epic-wave section 5: the example of the two lines" bash -c 'grep -qxF "07: Agents: eco" <<<"$1" && grep -qxF "07: Subagents: 2 — impl-07, verify-07" <<<"$1"' _ "$ew5"
# The order of "Which depth": the argument (or the owner's word), then eco, then the review.depth fields, then no field.
# in_order <text> <line start>... — each line start begins a line of the text, each one below the one before.
in_order() {
    local text="$1" prev=0 n p; shift
    for p in "$@"; do
        n="$(awk -v p="$p" 'index($0, p) == 1 { print NR; exit }' <<<"$text")"
        [ -n "$n" ] && [ "$n" -gt "$prev" ] || return 1
        prev="$n"
    done
}
check "ship-ticket step 7: Which depth — argument, eco, the profile fields, no field" in_order "$st7" \
    '1. An argument:' '2. The agents mode: when the mode of the ticket is `eco`' '3. The profile: the first review round' '4. No field (exit 4 or `null`) and no argument'
check "ship-ticket step 7: item 2 — eco gives low depth, one reviewer with one lens" in_flat "$st7" \
    '2. The agents mode: when the mode of the ticket is `eco` (paragraph "Agents mode" below: `F workflow.agents` `eco`, and none of the cases where `full` is required applies to the diff of the round), every review round of the ticket'"'"'s own diff has `low` depth — one reviewer with one lens. The report names the source `workflow.agents: eco`.'
check "ship-ticket step 7: the Agents mode paragraph points at item 2" in_flat "$st7" \
    'With `eco` every review round of the ticket'"'"'s own diff has `low` depth by item 2 of the list "Which depth".'
check "ship-ticket step 7: the source workflow.agents: eco of the depth line" in_flat "$st7" \
    '`<where it came from>` is `argument`, `owner'"'"'s word`, `workflow.agents: eco`, `review.depth.<field>` or `default: the profile has no review.depth.<field>`.'
check "ship-ticket step 7: no pointer to itself" lacks_re_text "$st7" '`/worfy:ship-ticket`, step 7'
check "ship-ticket step 7: the mode is decided on the diff of the round" in_flat "$st7" 'The mode is decided on the diff of the round, before its reviewers start.'
check "both skills decide the full cases on the diff: ship-ticket before its reviewers, epic-wave before the verifier" \
    bash -c '[[ "$1" == *"checks it again on the diff of a small ticket"* && "$2" == *"decided on the diff of the round"* ]]' _ "$(flat "$ew1")" "$(flat "$st7")"
# The draft schema, run through bin/project-connect --schema-only as skill connect-project proposes it.
AM="$T/agents-mode"; mkdir -p "$AM/hh" "$AM/repo"; AM="$(cd "$AM" && node_path "$(pwd -P)")"
# agents_schema <name> <expected exit> <expected output fragment> <workflow.agents as JSON, or "none">
#               [<the profile's agents (model and effort by role) as JSON, or "none">]
agents_schema() {
    local out code
    node - "$4" "$AM/repo" "${5:-none}" >"$AM/draft.json" <<'NODE' || { bad "$1 (the draft was not built)"; return; }
const [agents, match, roles] = process.argv.slice(2)
const workflow = { folder: null, ticket_skill: "ship-ticket", implementer_steps: "steps 1-8", finish: "local-green", merge: "orchestrator" }
if (agents !== "none") workflow.agents = JSON.parse(agents)
const profile = {
  schema: 2, name: "shop", title: "shop", mode: "full",
  language: { reports: "en", team: "en", docs: "en" }, attribution: "on",
  layout: { summary: "one package", packages: ["."], repos: null }, stack: ["node"],
  commands: { install: "npm ci", lint: "npm run lint", typecheck: null, test: "npm test", test_one: null, contract: null, e2e: null,
              build: null, verify: "npm run lint && npm test", prepare_tree: "npm ci", requires: [] },
  parallel: "worktrees",
  worktree: { root: match + "/.claude/worktrees/", base: "origin/main", implementer: null, reviewer: null },
  tickets: { root: ".scratch/", path: ".scratch/<epic>/issues/NN-*.md", trail_section: "## Where in the code", spec: ".scratch/<epic>/spec.md", branch: null },
  workflow, numbering: null, deploy: null, github: { account: null }, docs: null, lessons: "repo:docs/lessons",
  mcp: { allowed: ["plugin_worfy_qmd", "worfy-canvas"] }, review: { lenses: ["correctness"], ticket_lenses: ["correctness"] },
}
if (roles !== "none") profile.agents = JSON.parse(roles)
const gate = [{ key: "shop", match, profile: "shop", pm: "npm", root: { fast: ["lint", "test"], full: ["lint", "test"] }, workspace: {} }]
process.stdout.write(JSON.stringify({ profile, rules: "# shop\n\n## Sources\n\n- package.json\n", gate }))
NODE
    out="$(HARNESS_HOME="$AM/hh" "$HARNESS/bin/project-connect" --schema-only <"$AM/draft.json" 2>&1)"; code=$?
    if [ "$code" -eq "$2" ] && [[ "$out" == *"$3"* ]]; then ok "$1"; else bad "$1 (exit $code: $(printf '%s' "$out" | head -c 400))"; fi
}
agents_schema "schema: no workflow.agents passes" 0 '"ok": true' none
agents_schema "schema: workflow.agents eco passes" 0 '"ok": true' '"eco"'
agents_schema "schema: workflow.agents full passes" 0 '"ok": true' '"full"'
agents_schema "schema: workflow.agents null passes" 0 '"ok": true' null
agents_schema "schema: another value is refused, the field named" 1 '"path": "profile.workflow.agents"' '"lean"'
agents_schema "schema: a value in another case is refused" 1 '"path": "profile.workflow.agents"' '"ECO"'
agents_schema "schema: a number is refused" 1 '"path": "profile.workflow.agents"' 2
check "schema: --schema-only wrote nothing into HARNESS_HOME" test -z "$(ls -A "$AM/hh")"
# 9f. Model and effort by role: the profile fields agents.<role>.model (sonnet | opus) and agents.<role>.effort
# (low | medium | high) for implementer, reviewer, scout and verifier. Both skills pass them as the Agent
# parameters model and effort; an argument or the owner's word overrides them for one ticket; no field — no
# parameter, the agent's frontmatter as before; the report names the model, the effort and their source.
M_OVERRIDE='An argument of the skill or the owner'"'"'s word in a message (`Ticket 05 — opus`, in any language) overrides the profile field for that one ticket.'
M_NOFIELD='No field (exit 4 or `null`) and no argument — no parameter: the agent runs with the `model` and `effort` of its frontmatter, as before.'
M_OTHER='Any other value, `haiku` too, is not passed: the next source decides, and the report names the reason.'
M_LINE='The report names them for every agent it started: `Model: <model> (<where it came from>), effort: <effort> (<where it came from>)`, where `<where it came from>` is `argument`, `owner'"'"'s word`, `agents.<role>` or `frontmatter`.'
for f in "$EW" "$ST"; do
    n="$(name_of "$f")"; if [ "$f" = "$EW" ]; then s="$ew2"; else s="$st7"; fi
    check "$n: an argument and the owner's word override the profile field" in_flat "$s" "$M_OVERRIDE"
    check "$n: no field — the frontmatter, as before" in_flat "$s" "$M_NOFIELD"
    check "$n: haiku and other values are not passed" in_flat "$s" "$M_OTHER"
    check "$n: the Model line of the report" in_flat "$s" "$M_LINE"
done
check "epic-wave section 2: the implementer call with model and effort from F agents.implementer" in_flat "$ew2" \
    '`Agent({subagent_type: "worfy:implementer", name: "impl-<NN>", model: <F agents.implementer.model>, effort: <F agents.implementer.effort>, …})`'
check "epic-wave section 2: the four roles, the verifier and the sceptics placed" in_flat "$ew2" \
    'where `<role>` is `implementer`, `scout`, `verifier` (agent `worfy:reviewer` with the lens "implementer'"'"'s report") or `reviewer` (the other reviewers and the sceptics).'
check "epic-wave section 2: the argument form" in_flat "$ew2" 'The argument is `<NN> model <sonnet|opus>` or `<NN> effort <low|medium|high>` after the list of tickets'
check "ship-ticket step 7: the reviewer call with model and effort from F agents.reviewer" in_flat "$st7" \
    '`Agent({subagent_type: "worfy:reviewer", model: <F agents.reviewer.model>, effort: <F agents.reviewer.effort>, …})`'
check "ship-ticket step 7: the argument form" in_flat "$st7" 'The argument is `/worfy:ship-ticket <epic> <NN> model <sonnet|opus> effort <low|medium|high>`'
check "epic-wave section 5: the Model lines of every ticket" in_flat "$ew5" 'and the `Model:` line of each of its agents (section 2)'
check "epic-wave section 5: the example Model line" bash -c 'grep -qxF "07: verify-07 — Model: sonnet (agents.verifier), effort: high (frontmatter)" <<<"$1"' _ "$ew5"
# The frontmatter of the agents does not change: an old profile without the fields works as before.
for a in implementer:inherit:high reviewer:inherit:high scout:sonnet:medium; do
    IFS=: read -r who model effort <<<"$a"
    check "agents/$who.md keeps model: $model and effort: $effort" bash -c \
        'head -12 "$1" | grep -qx "model: $2" && head -12 "$1" | grep -qx "effort: $3"' _ "$HARNESS/agents/$who.md" "$model" "$effort"
done
for fld in model effort; do
    check "README: a row for agents.<role>.$fld" grep -qF "| \`agents.<role>.$fld\` |" "$RD"
done
check "README: the model values" grep -qF '| `agents.<role>.model` | `"sonnet"` \| `"opus"` \| null |' "$RD"
check "README: the effort values" grep -qF '| `agents.<role>.effort` | `"low"` \| `"medium"` \| `"high"` \| null |' "$RD"
check "README: haiku is refused" in_flat "$rd" '`"haiku"` — the draft schema refuses it'
check "README: no field — the frontmatter, as before" in_flat "$rd" 'absent or `null` — no parameter: the agent'"'"'s frontmatter, as before'
agents_schema "schema: no agents passes" 0 '"ok": true' none none
agents_schema "schema: agents.implementer.model sonnet passes" 0 '"ok": true' none '{"implementer":{"model":"sonnet"}}'
agents_schema "schema: agents.implementer.model opus passes" 0 '"ok": true' none '{"implementer":{"model":"opus"}}'
agents_schema "schema: the four roles with model and effort pass" 0 '"ok": true' none \
    '{"implementer":{"model":"opus","effort":"high"},"reviewer":{"model":"sonnet","effort":"medium"},"scout":{"model":"sonnet","effort":"low"},"verifier":{"model":"sonnet","effort":"high"}}'
agents_schema "schema: null role and null fields pass" 0 '"ok": true' none '{"scout":null,"reviewer":{"model":null,"effort":null}}'
agents_schema "schema: agents.implementer.model haiku is refused, the field named" 1 '"path": "profile.agents.implementer.model"' none '{"implementer":{"model":"haiku"}}'
agents_schema "schema: a full model ID is refused" 1 '"path": "profile.agents.reviewer.model"' none '{"reviewer":{"model":"claude-opus-5-5"}}'
agents_schema "schema: effort max is refused" 1 '"path": "profile.agents.verifier.effort"' none '{"verifier":{"effort":"max"}}'
agents_schema "schema: an unknown role is refused" 1 '"path": "profile.agents.tester"' none '{"tester":{"model":"sonnet"}}'
agents_schema "schema: an unknown field of a role is refused" 1 '"path": "profile.agents.scout.temperature"' none '{"scout":{"temperature":1}}'
agents_schema "schema: agents as a string is refused" 1 '"path": "profile.agents"' none '"sonnet"'
check "schema: --schema-only wrote nothing into HARNESS_HOME (agents by role)" test -z "$(ls -A "$AM/hh")"
# 10. The temporary HOME recipe of section 2 runs. It is cut out of the skill, with `true` for
# <commands.verify>, and runs in a temporary git repository that a stand-in registry of a stand-in
# home registers. The recipe's gate finds that registry: both EXIT=0 and the green line. The same
# gate under a temporary HOME without HARNESS_HOME finds none: exit 3. With only EVAL_HARNESS_HOME
# of an eval run set, the recipe's own helper call must find <repository>/.git/worfy-harness: the
# variable is unset before the gate line, so the gate cannot find that folder by itself. The
# stand-in home is left untouched. The recipe's `mktemp -d` folders go under "$RT/tmp", inside the
# test's own temporary tree, so the trap removes them: a mktemp first on PATH gives a bare
# `mktemp -d` a template under TMPDIR, because the mktemp of recent macOS ignores TMPDIR.
RT="$T/recipe"; mkdir -p "$RT/home" "$RT/home2" "$RT/home3" "$RT/repo" "$RT/tmp" "$RT/bin"
RT="$(cd "$RT" && { pwd -W 2>/dev/null || pwd -P; })"                   # the spelling node reads
recipe="$(skill_block "$EW" 'eval-env.cjs" harness-home' | sed 's/<commands\.verify>/true/')"
check "the recipe block is cut out of the skill" test -n "$recipe"
# The same recipe with EVAL_HARNESS_HOME unset just before the gate line: only H can carry it on.
printf '#!/bin/sh\n[ "$*" = -d ] && exec "%s" -d "$TMPDIR/tmp.XXXXXXXX"\nexec "%s" "$@"\n' "$(command -v mktemp)" "$(command -v mktemp)" >"$RT/bin/mktemp"
chmod +x "$RT/bin/mktemp"
recipe_eval="$(awk '/hooks\/gate\.mjs/ { print "unset EVAL_HARNESS_HOME" } { print }' <<<"$recipe")"
if on_windows; then PMS="$RT/pm.cmd"; printf '@echo off\r\nexit /b 0\r\n' >"$PMS"; else PMS="$RT/pm"; printf '#!/bin/sh\nexit 0\n' >"$PMS"; chmod +x "$PMS"; fi
echo '{ "name": "r", "scripts": { "lint": "true" } }' >"$RT/repo/package.json"
git init -q -b main "$RT/repo" && git -C "$RT/repo" add -A && git -C "$RT/repo" -c user.email=t@t -c user.name=t commit -q -m init
registry() { mkdir -p "$1/gate"; printf '{"repos":[{"key":"t","match":"%s","pm":"%s","root":{"fast":["lint"]},"workspace":{}}]}\n' "$RT/repo" "$PMS" >"$1/gate/config.json"; }
registry "$RT/home/.claude/worfy-harness"; registry "$RT/repo/.git/worfy-harness"
clean_env=(env -u HARNESS_HOME -u EVAL_HARNESS_HOME -u CLAUDE_GATE_CONFIG -u CLAUDE_GATE_STATE -u CLAUDE_GATE_RESOLVE GATE_SCOPE=all CLAUDE_PLUGIN_ROOT="$HARNESS" TMPDIR="$RT/tmp" PATH="$RT/bin:$PATH")
short() { local t="${1//$'\n'/ }"; printf '%s' "${t:0:200}"; }   # one line of output for a failed check
for sh in "${SHELLS[@]}"; do
    out="$(cd "$RT/repo" && "${clean_env[@]}" HOME="$RT/home" USERPROFILE="$RT/home" "$sh" -c "$recipe" 2>&1)"
    check "$sh: the recipe — both commands EXIT=0, gate green${out:+ — got: $(short "$out")}" \
        bash -c '[ "$(grep -c "^EXIT=0$" <<<"$1")" -eq 2 ] && grep -q "^\[gate\] green (fast)" <<<"$1"' _ "$out"
    out="$(cd "$RT/repo" && "${clean_env[@]}" HOME="$RT/home2" USERPROFILE="$RT/home2" EVAL_HARNESS_HOME=worfy-harness "$sh" -c "$recipe_eval" 2>&1)"
    check "$sh: the recipe with only EVAL_HARNESS_HOME — gate green on <repository>/.git/worfy-harness${out:+ — got: $(short "$out")}" \
        bash -c '[ "$(grep -c "^EXIT=0$" <<<"$1")" -eq 2 ] && grep -q "^\[gate\] green (fast)" <<<"$1"' _ "$out"
done
check "the recipe's gate wrote its verdict into the stand-in Harness home" bash -c 'ls "$1"/verdict-* >/dev/null 2>&1' _ "$RT/home/.claude/worfy-harness/gate/state"
check "with only EVAL_HARNESS_HOME the stand-in home stays empty" test -z "$(ls -A "$RT/home2")"
check "the recipe's temporary folders are under the test's TMPDIR (one per run)" \
    test "$(ls -A "$RT/tmp" | wc -l | tr -d ' ')" -eq $((2 * ${#SHELLS[@]}))
out="$(cd "$RT/repo" && "${clean_env[@]}" HOME="$RT/home3" USERPROFILE="$RT/home3" node "$HARNESS/hooks/gate.mjs" fast </dev/null 2>&1)"; rc=$?
check "the gate under a temporary HOME without HARNESS_HOME — exit 3, not verified — got $rc: $(short "$out")" \
    bash -c '[ "$1" -eq 3 ] && grep -q "^\[gate\] not verified" <<<"$2"' _ "$rc" "$out"

home_after="$(real_home_snapshot "$REAL_HOME" "$T")"
check "the real ~/.claude and ~/.claude/worfy-harness are unchanged" test "$home_before" = "$home_after"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
