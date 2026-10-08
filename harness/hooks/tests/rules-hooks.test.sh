#!/usr/bin/env bash
# Tests of the Harness rules that reach a session through hooks (ticket worfy-harness/05, ADR-0041):
# the parts in hooks/rules/, hooks/inject-rules.sh and the hook wiring in hooks/hooks.json.
# Run: bash harness/hooks/tests/rules-hooks.test.sh; exit code 0 means every check passed.
#
# Everything is found next to this file (harness/); nothing under $HOME is read or written.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd -P)"
HOOKS="$HARNESS/hooks"
RULES="$HOOKS/rules"
INJECT="$HOOKS/inject-rules.sh"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# One additionalContext string is cut to a preview above this many characters (ADR-0041).
LIMIT=10000
# A plugin root as long as a real install path is likely to get; the parts must fit with it.
LONG_ROOT="/Users/someone-with-a-long-name/.claude/plugins/cache/worfy-local-marketplace/worfy/10.20.30-build.12345"

chars() { jq -Rs 'length' <"$1"; }

# --- 1. The parts: size and label --------------------------------------------------------------

[ -f "$RULES/orchestrator.md" ] && ok "orchestrator.md exists" || bad "orchestrator.md missing"
[ -f "$RULES/common.md" ] && ok "common.md exists" || bad "common.md missing"

parts=()
for f in "$RULES"/*.md; do [ -f "$f" ] && parts+=("$f"); done
[ "${#parts[@]}" -ge 2 ] && ok "at least two parts (${#parts[@]})" || bad "fewer than two parts (${#parts[@]})"

# "${parts[@]+…}": bash 3.2 (macOS) treats an empty array as unbound under set -u.
for f in ${parts[@]+"${parts[@]}"}; do
    name="$(basename "$f" .md)"
    n="$(chars "$f")"
    [ "$n" -le "$LIMIT" ] && ok "$name.md: $n characters <= $LIMIT" || bad "$name.md: $n characters > $LIMIT"
    first="$(head -n 1 "$f")"
    case "$name" in
        orchestrator) want="# worfy Harness — orchestrator rules" ;;
        common) want="# worfy Harness — common rules" ;;
        *) want="# worfy Harness — $name rules" ;;
    esac
    [ "$first" = "$want" ] && ok "$name.md: first line is the label" || bad "$name.md: first line is '$first'"
    # A part arrives in an order no one controls (hooks of one event run in parallel), so it may
    # not point at text in another part.
    if grep -qiE '\((see )?(above|below)\)|see (above|below)' "$f"; then
        bad "$name.md: points at text outside itself (above/below)"
    else
        ok "$name.md: no 'see above' pointers"
    fi
done

# --- 2. inject-rules.sh: output for SessionStart and SubagentStart ----------------------------

[ -x "$INJECT" ] && ok "inject-rules.sh is executable" || bad "inject-rules.sh missing or not executable"

# $1 part, $2 stdin, then env assignments; stdout -> $T/out, stderr -> $T/err, sets rc
run_inject() {
    local part="$1" input="$2"; shift 2
    (printf '%s' "$input" | env "$@" bash "$INJECT" "$part" >"$T/out" 2>"$T/err"); rc=$?
}
ctx() { jq -r '.hookSpecificOutput.additionalContext // empty' <"$T/out" 2>/dev/null; }
event() { jq -r '.hookSpecificOutput.hookEventName // empty' <"$T/out" 2>/dev/null; }

for ev in SessionStart SubagentStart; do
    for part in orchestrator common; do
        input="{\"session_id\":\"t-1\",\"transcript_path\":\"/tmp/t.jsonl\",\"cwd\":\"/tmp\",\"hook_event_name\":\"$ev\",\"source\":\"startup\",\"agent_id\":\"a-1\",\"agent_type\":\"general-purpose\"}"
        run_inject "$part" "$input" CLAUDE_PLUGIN_ROOT=/opt/worfy-plugin
        [ "$rc" -eq 0 ] && ok "$ev/$part: exit 0" || bad "$ev/$part: exit $rc"
        [ "$(event)" = "$ev" ] && ok "$ev/$part: hookEventName is $ev" || bad "$ev/$part: hookEventName '$(event)'"
        expected="$(sed 's#${CLAUDE_PLUGIN_ROOT}#/opt/worfy-plugin#g' "$RULES/$part.md")"
        [ -n "$expected" ] && [ "$(ctx)" = "$expected" ] \
            && ok "$ev/$part: additionalContext is the part with the plugin root substituted" \
            || bad "$ev/$part: additionalContext differs from the part"
        if grep -qF '${CLAUDE_PLUGIN_ROOT}' "$T/out"; then
            bad "$ev/$part: \${CLAUDE_PLUGIN_ROOT} left in the output"
        else
            ok "$ev/$part: no \${CLAUDE_PLUGIN_ROOT} in the output"
        fi
        [ ! -s "$T/err" ] && ok "$ev/$part: nothing on stderr" || bad "$ev/$part: stderr '$(head -c 200 "$T/err")'"
    done
done

# The parts still fit when the plugin root is a long install path.
for part in orchestrator common; do
    run_inject "$part" '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT="$LONG_ROOT"
    n="$(ctx | jq -Rs 'length')"
    [ "$n" -le "$LIMIT" ] && ok "$part: $n characters with a long plugin root" || bad "$part: $n characters > $LIMIT with a long plugin root"
done

# --- 3. Plugin root from the script's own path; failures stay quiet ----------------------------

run_inject common '{"hook_event_name":"SubagentStart"}' -u CLAUDE_PLUGIN_ROOT
c="$(ctx)"
[ "$rc" -eq 0 ] && [[ "$c" == *"$HARNESS/hooks/gate.sh"* ]] && [[ "$c" != *'${CLAUDE_PLUGIN_ROOT}'* ]] \
    && ok "no env: plugin root is the folder above hooks/ ($HARNESS)" \
    || bad "no env: rc=$rc, plugin root not substituted from the script path"

run_inject common '{"hook_event_name":"SubagentStart"}' CLAUDE_PLUGIN_ROOT=
c="$(ctx)"
[ "$rc" -eq 0 ] && [[ "$c" == *"$HARNESS/hooks/gate.sh"* ]] \
    && ok "empty env: treated as unset" || bad "empty env: rc=$rc, plugin root not from the script path"

# $1 description: exit 0, no additionalContext, exactly one line on stderr
expect_quiet_failure() {
    local what="$1" lines
    lines="$(wc -l <"$T/err" | tr -d ' ')"
    [ "$rc" -eq 0 ] && ok "$what: exit 0" || bad "$what: exit $rc"
    if grep -q additionalContext "$T/out"; then bad "$what: additionalContext printed"; else ok "$what: no additionalContext"; fi
    [ "$lines" = 1 ] && [ -s "$T/err" ] && ok "$what: one line on stderr" || bad "$what: $lines lines on stderr"
}

run_inject no-such-part '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT=/x
expect_quiet_failure "missing part file"
run_inject common '' CLAUDE_PLUGIN_ROOT=/x
expect_quiet_failure "empty stdin"
run_inject common 'not json' CLAUDE_PLUGIN_ROOT=/x
expect_quiet_failure "stdin is not JSON"
run_inject common '{"session_id":"t-1"}' CLAUDE_PLUGIN_ROOT=/x
expect_quiet_failure "no hook_event_name"
run_inject '' '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT=/x
expect_quiet_failure "no part argument"
run_inject ../hooks/hooks '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT=/x
expect_quiet_failure "part name with a path"

# --- 4. Paths and names inside the parts -------------------------------------------------------

all="$T/all.md"
cat "$RULES"/*.md >"$all" 2>/dev/null
for p in '~/.claude/bin' '~/.claude/hooks' '~/.claude/profiles' '$HOME/.claude'; do
    if grep -qF "$p" "$all"; then bad "parts mention $p"; else ok "parts do not mention $p"; fi
done
for p in '${CLAUDE_PLUGIN_ROOT}/bin/profile' '${CLAUDE_PLUGIN_ROOT}/profiles/README.md' \
    '${CLAUDE_PLUGIN_ROOT}/bin/epic-status' '${CLAUDE_PLUGIN_ROOT}/bin/ticket' \
    '${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh fast' \
    'worfy:scout' 'worfy:implementer' 'worfy:reviewer' 'worfy:qmd'; do
    grep -qF -- "$p" "$all" && ok "parts name $p" || bad "parts do not name $p"
done
for p in '`scout`' '`implementer`' '`reviewer`' '`qmd` query' 'skill `qmd`'; do
    if grep -qF -- "$p" "$all"; then bad "parts use the bare name $p"; else ok "no bare $p"; fi
done
[ -f "$HARNESS/profiles/README.md" ] && ok "profiles/README.md exists in the plugin" || bad "profiles/README.md missing"

# --- 5. No rule lost ---------------------------------------------------------------------------

# Every topic of the old global rules (~/.claude/CLAUDE.md, imported as rules/global.md), from
# "Default loop" to "Context hygiene", except "Standing authorization" (the user's own consent,
# ticket 05 item 3). Each line: a topic and phrases that carry its rules.
ORCH_TOPICS=(
    'Orchestrator role|orchestrator|main context'
    'Project profile|profile|`-C <path>`|--field|exit code|`0`|`3`|`1` / `2`|`4`'
    'Default loop|Default loop|Restate the task|Phase 0|Phase 2|Phase 3|summaries'
    'Answering, not exploring|Answering, not exploring|confidence|hypothesis|lead with the number'
    'Phase 0|Phase 0|read-only|entry points|call chain|exact files to touch|qmd.collections'
    'Delegate by default|Delegate by default|>200 lines|grep/glob|research|First draft|several agents in one message|side quests'
    'Your own hands|closed list|Single-file edit|targeted read|Trivial follow-ups|Coupled sequential chains|raw output drives'
    'Quota|Quota|Before a phase|fifth|out loud'
    'Long output|Long output|~15 lines|needs interpretation'
    'Subagent contract|Subagent contract|exact output format|30 lines|"not found"|repo or worktree path'
    'Phase 2|Phase 2|one file and under ~20 lines|review.lenses|leaked secrets|self-check'
    'Phase 3: status block|status block|purely conversational|Four lines|Only verified state goes in'
    'Phase 3: ticket status|`claim`|`block <reason>`|`done <epic> <NN>`|--pr <N>|tickets.path'
    'Phase 3: state file|docs.handoff|phase boundaries|second state file'
    'Phase 3: ADR vs state file|immutable|links only|docs.adr_dir'
)
COMMON_TOPICS=(
    'Plain language|Plain language|never seen this project|smoke test|gloss it'
    'Writing in Russian|Russian|stays in Latin|«ручка»|«задеплоить»|docs.context'
    'Metaphors|Metaphors|plainly'
    'Codes carry their meaning|Codes carry their meaning|backlog/18|next message explains again'
    "Restate, don't point back|Restate, don't point back|as above"
    'Short sentences|Short sentences'
    'Self-check before sending|Self-check before sending|joined today'
    'Scope|Casual chat'
    'Which language|language.reports|language.team|With no profile'
    'Evidence before "green"|Evidence before "green"|set -o pipefail|PreToolUse|exit code|not from reading the diff|Neither is reported as done'
    'Gate verdict|`2` is red|`3`|never green|is green only when|nothing ran|commands.verify|gate did not run'
    'Deployed|live endpoint'
    'Subagent claims|is a claim, not a fact|Re-read the line'
    'Context hygiene|Context hygiene|minimal fragment|`Edit`|compress|Unbounded output|only what changed'
)

# $1 file to search, topics follow. The text is searched as one line with whitespace runs
# collapsed, so a phrase may wrap across lines.
check_topics() {
    local file="$T/flat.txt" line topic phrase missing
    tr '\n' ' ' <"$1" 2>/dev/null | tr -s ' ' >"$file"
    shift
    for line in "$@"; do
        topic="${line%%|*}"
        missing=""
        IFS='|' read -r -a phrases <<<"${line#*|}"
        for phrase in "${phrases[@]}"; do
            grep -qF -- "$phrase" "$file" || missing="$missing [$phrase]"
        done
        [ -z "$missing" ] && ok "topic kept: $topic" || bad "topic $topic: missing$missing"
    done
}
check_topics "$all" "${ORCH_TOPICS[@]}"
check_topics "$RULES/common.md" "${COMMON_TOPICS[@]}"

# common.md holds exactly Plain language, Evidence before "green" and Context hygiene.
heads="$(grep '^## ' "$RULES/common.md" 2>/dev/null | tr '\n' '|')"
[ "$heads" = '## Plain language|## Evidence before "green"|## Context hygiene|' ] \
    && ok "common.md sections: Plain language, Evidence, Context hygiene" || bad "common.md sections: $heads"
for p in 'Phase 0' 'Quota' 'Default loop' 'Phase 2' 'Phase 3' 'Delegate by default' 'Subagent contract'; do
    if grep -qF "$p" "$RULES/common.md" 2>/dev/null; then bad "common.md carries the orchestrator topic $p"; else ok "common.md has no $p"; fi
done

# --- 6. Machine-read strings and Cyrillic --------------------------------------------------------

# The status block lines as worfy parses them: LINE in src/shared/agent/status-block.ts.
for label in Этап Сейчас Дальше Жду; do
    grep -qE "^[[:space:]]*[—–-][[:space:]]*$label[[:space:]]*:" "$RULES/orchestrator.md" 2>/dev/null \
        && ok "orchestrator.md: status line '— $label:'" || bad "orchestrator.md: no status line '— $label:'"
done
for p in '[gate] зелено (…)' 'ничего не прогналось' 'ПРОВЕРИТЬ НЕ УДАЛОСЬ'; do
    grep -qF -- "$p" "$all" && ok "gate verdict words kept: $p" || bad "gate verdict words missing: $p"
done

# Cyrillic only in the status labels, the gate verdict words and the Russian examples of the
# section on writing in Russian.
ALLOWED='["Этап","Сейчас","Дальше","Жду","[gate] зелено","ничего не прогналось","ПРОВЕРИТЬ НЕ УДАЛОСЬ","«ручка»","«проба»","«выкат»","«заглушка»","«задеплоить»","«прогнать»","«деплой»"]'
for f in ${parts[@]+"${parts[@]}"}; do
    left="$(jq -Rrs --argjson a "$ALLOWED" \
        'reduce $a[] as $s (.; split($s) | join("")) | [scan("[Ѐ-ӿ]+")] | unique | join(" ")' <"$f")"
    [ -z "$left" ] && ok "$(basename "$f"): Cyrillic only in allowed strings" || bad "$(basename "$f"): Cyrillic outside allowed strings: $left"
done

for p in Telegram 'Standing authorization'; do
    if grep -qiF "$p" "$all"; then bad "parts mention $p"; else ok "parts do not mention $p"; fi
done
if grep -qwE '(me|my|I)' "$all"; then
    bad "parts speak as the user (me/my/I): $(grep -nwE '(me|my|I)' "$all" | head -n 3 | tr '\n' ' ')"
else
    ok "parts say 'the user', not me/my/I"
fi

# --- 7. hooks.json ------------------------------------------------------------------------------

HJ="$HOOKS/hooks.json"
if jq -e .hooks "$HJ" >/dev/null 2>&1; then ok "hooks.json is valid JSON with .hooks"; else bad "hooks.json missing or invalid"; fi

# The hooks of ~/.claude/settings.json:5-109, plus the three inject-rules entries; qmd-refresh came
# with the qmd server of the plugin (worfy-harness ticket 17). One line per hook: event|matcher|command|timeout.
R='"${CLAUDE_PLUGIN_ROOT}'
# Read outside $(…): macOS bash 3.2 cannot parse a here-document with an odd number of quotes
# inside a command substitution.
IFS= read -r -d '' hooks_expected <<EOF
SessionStart||$R/hooks/session-start.sh"|15
SessionStart||$R/bin/worktree-lock" claim|10
SessionStart||$R/hooks/inject-rules.sh" orchestrator|10
SessionStart||$R/hooks/inject-rules.sh" common|10
SessionStart||$R/hooks/gh-token-env.sh"|10
SubagentStart||$R/hooks/inject-rules.sh" common|10
TaskCompleted||$R/hooks/gate.sh" fast|900
TeammateIdle||$R/hooks/gate.sh" fast|900
Stop||$R/hooks/stop.sh"|10
Stop||$R/bin/worktree-lock" beat|5
Stop||$R/bin/qmd-refresh" --quiet|15
SessionEnd||$R/hooks/session-end.sh"|10
SessionEnd||$R/bin/worktree-lock" release|5
PreToolUse|Bash|$R/hooks/guard.mjs"|10
EOF
expected="$(printf '%s' "$hooks_expected" | sort)"
actual="$(jq -r '.hooks | to_entries[] | .key as $e | .value[] | (.matcher // "") as $m
    | .hooks[] | "\($e)|\($m)|\(.command)|\(.timeout)"' "$HJ" 2>/dev/null | sort)"
if [ "$actual" = "$expected" ]; then
    ok "hooks.json: events, matchers, commands and timeouts as expected"
else
    bad "hooks.json differs: $(diff <(echo "$expected") <(echo "$actual") | grep '^[<>]' | tr '\n' ' ')"
fi
types="$(jq -r '[.hooks[][] | .hooks[] | .type] | unique | join(",")' "$HJ" 2>/dev/null)"
[ "$types" = command ] && ok "hooks.json: every hook is a command" || bad "hooks.json: hook types '$types'"
if grep -q 'bin/qmd-refresh.* --quiet' "$HJ" 2>/dev/null; then ok "hooks.json: Stop runs qmd-refresh --quiet"; else bad "hooks.json: no qmd-refresh"; fi

# Every command path, with ${CLAUDE_PLUGIN_ROOT} = harness, exists and is executable.
while IFS= read -r cmd; do
    path="$(printf '%s' "$cmd" | sed -n 's#^"\${CLAUDE_PLUGIN_ROOT}\(/[^"]*\)".*#\1#p')"
    if [ -z "$path" ]; then bad "command not of the form \"\${CLAUDE_PLUGIN_ROOT}/…\": $cmd"; continue; fi
    [ -x "$HARNESS$path" ] && ok "executable: $path" || bad "not executable or missing: $path"
done < <(jq -r '[.hooks[][] | .hooks[] | .command] | unique[]' "$HJ" 2>/dev/null)

# The inject-rules commands of hooks.json, run the way Claude Code runs them, print their part.
while IFS='|' read -r ev cmd; do
    out="$(printf '{"hook_event_name":"%s"}' "$ev" | CLAUDE_PLUGIN_ROOT="$HARNESS" sh -c "$cmd" 2>/dev/null)"
    part="${cmd##* }"
    first="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null | head -n 1)"
    [ "$first" = "# worfy Harness — $part rules" ] && ok "hooks.json $ev runs $part" || bad "hooks.json $ev '$cmd': got '$first'"
done < <(jq -r '.hooks | to_entries[] | .key as $e | .value[] | .hooks[] | select(.command | contains("inject-rules.sh"))
    | "\($e)|\(.command)"' "$HJ" 2>/dev/null)

# --- 8. The old rules file is gone --------------------------------------------------------------

[ ! -e "$HARNESS/rules/global.md" ] && ok "rules/global.md removed" || bad "rules/global.md still there"
[ ! -e "$HARNESS/rules" ] && ok "rules/ removed" || bad "rules/ still there"

echo "--- passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
