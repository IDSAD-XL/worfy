#!/usr/bin/env bash
# Tests of the Harness rules that reach a session through hooks (ticket worfy-harness/05, ADR-0041):
# the parts in hooks/rules/, hooks/inject-rules.mjs and the hook wiring in hooks/hooks.json.
# Run: bash harness/hooks/tests/rules-hooks.test.sh; exit code 0 means every check passed.
#
# Everything is found next to this file (harness/); nothing under $HOME is read or written.
# JSON is read with node, not jq: Git Bash on Windows has no jq (worfy-windows ticket 04).
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd -P)"
# The plugin folder as node prints it: C:/… in Git Bash on Windows (`pwd -W`), the same path elsewhere.
HARNESS_N="$(cd "$HARNESS" && { pwd -W 2>/dev/null || pwd -P; })"
HOOKS="$HARNESS/hooks"
RULES="$HOOKS/rules"
INJECT="$HOOKS/inject-rules.mjs"
# Git Bash hands a native program a variable that looks like a POSIX path in Windows spelling
# (/opt/x becomes C:/Program Files/Git/opt/x). Claude Code itself gives CLAUDE_PLUGIN_ROOT as C:/…;
# the plain roots below must reach node as they are written.
export MSYS2_ENV_CONV_EXCL=CLAUDE_PLUGIN_ROOT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
# The Harness state folder, where inject-rules looks for the user's own rules file: a temporary one,
# so the real user rules never reach these checks. Empty until section 3b puts a rules file there.
export HARNESS_HOME="$T/hh"
USER_RULES="$HARNESS_HOME/user/rules.md"

# One additionalContext string is cut to a preview above this many characters (ADR-0041).
LIMIT=10000
# A plugin root as long as a real install path is likely to get; the parts must fit with it.
LONG_ROOT="/Users/someone-with-a-long-name/.claude/plugins/cache/worfy-local-marketplace/worfy/10.20.30-build.12345"

# Characters (code points, as Claude Code counts a string), of a file or of stdin.
chars() { node -e 'process.stdout.write(String([...require("fs").readFileSync(0, "utf8")].length))' <"${1:-/dev/stdin}"; }
# A field of the hook output in $T/out ("" when it is not JSON or has no such field).
out_field() {
    node -e '
let o
try { o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")) } catch { process.exit(0) }
const v = (o && o.hookSpecificOutput || {})[process.argv[2]]
if (typeof v === "string") process.stdout.write(v + "\n")' "$T/out" "$1" 2>/dev/null
}

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

# --- 2. inject-rules.mjs: output for SessionStart and SubagentStart ---------------------------

[ -f "$INJECT" ] && ok "inject-rules.mjs exists" || bad "inject-rules.mjs missing"
# The bash hooks are gone (worfy-windows ticket 04); only the gate launcher gate.sh and the
# unregistered worktree-create.sh stay.
for old in inject-rules session-start session-end stop gh-token-env; do
    [ ! -e "$HOOKS/$old.sh" ] && ok "bash hook $old removed" || bad "bash hook $old still there"
done

# $1 part, $2 stdin, then env assignments; stdout -> $T/out, stderr -> $T/err, sets rc
run_inject() {
    local part="$1" input="$2"; shift 2
    (printf '%s' "$input" | env "$@" node "$INJECT" "$part" >"$T/out" 2>"$T/err"); rc=$?
}
ctx() { out_field additionalContext; }
event() { out_field hookEventName; }

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
    n="$(ctx | chars)"
    [ "$n" -le "$LIMIT" ] && ok "$part: $n characters with a long plugin root" || bad "$part: $n characters > $LIMIT with a long plugin root"
done

# The plugin root goes in literally: a Windows path (Claude Code spells it C:/…) and characters a
# replacement pattern would read ($&, $1) arrive as they are.
WROOT='C:/Users/x/plugin $& $1'
run_inject common '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT="$WROOT"
c="$(ctx)"
[ "$rc" -eq 0 ] && [[ "$c" == *"node \"$WROOT/hooks/gate.mjs\" fast"* ]] \
    && ok "plugin root C:/… with \$& and \$1: substituted literally" || bad "plugin root not substituted literally: rc=$rc"

# --- 3. Plugin root from the script's own path; failures stay quiet ----------------------------

run_inject common '{"hook_event_name":"SubagentStart"}' -u CLAUDE_PLUGIN_ROOT
c="$(ctx)"
[ "$rc" -eq 0 ] && [[ "$c" == *"$HARNESS_N/hooks/gate.mjs"* ]] && [[ "$c" != *'${CLAUDE_PLUGIN_ROOT}'* ]] \
    && ok "no env: plugin root is the folder above hooks/ ($HARNESS_N)" \
    || bad "no env: rc=$rc, plugin root not substituted from the script path"

run_inject common '{"hook_event_name":"SubagentStart"}' CLAUDE_PLUGIN_ROOT=
c="$(ctx)"
[ "$rc" -eq 0 ] && [[ "$c" == *"$HARNESS_N/hooks/gate.mjs"* ]] \
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

# --- 3b. The user's own rules ($HARNESS_HOME/user/rules.md) ------------------------------------
# inject-rules appends the file to the part "common" under "## User rules", in SessionStart and in
# SubagentStart, without reading its meaning. Without the file the part is unchanged (section 2).

part_with_root() { sed 's#${CLAUDE_PLUGIN_ROOT}#/opt/worfy-plugin#g' "$RULES/$1.md"; }
mkdir -p "$HARNESS_HOME/user"
printf 'Write reports in Klingon.\n\nKeep the token ${CLAUDE_PLUGIN_ROOT} as written.\n\n' >"$USER_RULES"
for ev in SessionStart SubagentStart; do
    run_inject common "{\"hook_event_name\":\"$ev\",\"cwd\":\"/tmp\"}" CLAUDE_PLUGIN_ROOT=/opt/worfy-plugin
    want="$(part_with_root common)"$'\n\n## User rules\n\nWrite reports in Klingon.\n\nKeep the token ${CLAUDE_PLUGIN_ROOT} as written.'
    [ "$rc" -eq 0 ] && [ "$(event)" = "$ev" ] && [ "$(ctx)" = "$want" ] \
        && ok "$ev/common + user rules: the part, then '## User rules' and the file as written" \
        || bad "$ev/common + user rules: rc=$rc, additionalContext differs: $(ctx | tail -n 4 | tr '\n' '|')"
    [ ! -s "$T/err" ] && ok "$ev/common + user rules: nothing on stderr" || bad "$ev/common + user rules: stderr '$(head -c 200 "$T/err")'"
done
# Only the common part carries the user rules: it reaches the main session and every subagent.
run_inject orchestrator '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT=/opt/worfy-plugin
[ "$(ctx)" = "$(part_with_root orchestrator)" ] && ok "orchestrator part: no user rules" || bad "orchestrator part: changed by the user rules"

# An empty file adds nothing.
: >"$USER_RULES"
run_inject common '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT=/opt/worfy-plugin
[ "$(ctx)" = "$(part_with_root common)" ] && [ ! -s "$T/err" ] \
    && ok "empty user rules file: the part as before" || bad "empty user rules file: output changed"

# A file the hook cannot read (a folder at that path): the part as before and one line on stderr.
rm -f "$USER_RULES"
mkdir "$USER_RULES"
run_inject common '{"hook_event_name":"SubagentStart"}' CLAUDE_PLUGIN_ROOT=/opt/worfy-plugin
lines="$(wc -l <"$T/err" | tr -d ' ')"
[ "$rc" -eq 0 ] && [ "$(ctx)" = "$(part_with_root common)" ] && [ "$lines" = 1 ] \
    && ok "unreadable user rules: the part as before, one line on stderr" || bad "unreadable user rules: rc=$rc, $lines stderr lines"
rmdir "$USER_RULES"

# A file longer than the limit: the whole additionalContext stays within LIMIT, the file is cut
# after a whole line, and a closing line names the file.
node -e 'for (let i = 1; i <= 600; i++) process.stdout.write(`Rule ${i}: keep the Klingon words as they are in every report.\n`)' >"$USER_RULES"
HH_N="$(cd "$HARNESS_HOME" && { pwd -W 2>/dev/null || pwd -P; })" # node's spelling of the folder
for ev in SessionStart SubagentStart; do
    run_inject common "{\"hook_event_name\":\"$ev\"}" CLAUDE_PLUGIN_ROOT="$LONG_ROOT"
    c="$(ctx)"
    n="$(printf '%s' "$c" | chars)"
    [ "$rc" -eq 0 ] && [ "$n" -le "$LIMIT" ] && ok "$ev: long user rules: $n characters <= $LIMIT" || bad "$ev: long user rules: rc=$rc, $n characters"
    [[ "$c" == *"$HARNESS_HOME/user/rules.md"* || "$c" == *"$HH_N/user/rules.md"* ]] \
        && ok "$ev: long user rules: the path to the file is named" || bad "$ev: long user rules: no path to the file"
    [[ "$c" == *$'\n## User rules\n\nRule 1: keep'* ]] && ok "$ev: long user rules: the start of the file is kept" || bad "$ev: long user rules: the start of the file is missing"
    # The last kept rule is whole: the cut falls between lines, not inside one.
    last="$(printf '%s\n' "$c" | grep '^Rule ' | tail -n 1)"
    [[ "$last" =~ ^Rule\ [0-9]+:\ keep\ the\ Klingon\ words\ as\ they\ are\ in\ every\ report\.$ ]] \
        && ok "$ev: long user rules: cut after a whole line (${last%%:*})" || bad "$ev: long user rules: cut inside a line: '$last'"
    [[ "$c" != *'Rule 600:'* ]] && ok "$ev: long user rules: the tail is cut" || bad "$ev: long user rules: nothing was cut"
done
rm -f "$USER_RULES"

# --- 4. Paths and names inside the parts -------------------------------------------------------

all="$T/all.md"
cat "$RULES"/*.md >"$all" 2>/dev/null
for p in '~/.claude/bin' '~/.claude/hooks' '~/.claude/profiles' '$HOME/.claude'; do
    if grep -qF "$p" "$all"; then bad "parts mention $p"; else ok "parts do not mention $p"; fi
done
for p in '${CLAUDE_PLUGIN_ROOT}/bin/profile' '${CLAUDE_PLUGIN_ROOT}/profiles/README.md' \
    '${CLAUDE_PLUGIN_ROOT}/bin/epic-status' '${CLAUDE_PLUGIN_ROOT}/bin/ticket' \
    'node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null; echo "EXIT=$?"' \
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
    'Metaphors|Metaphors|plainly'
    'Codes carry their meaning|Codes carry their meaning|backlog/18|next message explains again'
    "Restate, don't point back|Restate, don't point back|as above"
    'Short sentences|Short sentences'
    'Self-check before sending|Self-check before sending|joined today'
    'Scope|Casual chat'
    "Which language|language.reports|language.team|With no profile|Personal language rules, if any, come from the user's rules file."
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

# The decision log of a wave that runs without a human (worfy-review ticket 06) is not a second
# state file, and the rule against a second state file says so itself: the caveat is the paragraph
# right after it. Whole sentences, one after another, with line breaks folded into spaces.
flat="$(tr '\n' ' ' <"$RULES/orchestrator.md" 2>/dev/null | tr -s ' ')"
[[ "$flat" == *'Two files describing where we are means one of them is lying. The decision log of a wave that runs without a human (`decisions.tsv`, skill `worfy:epic-wave`) is not a state file.'* ]] \
    && ok "orchestrator.md: the decision log is not a state file — said right after the rule against a second state file" \
    || bad "orchestrator.md: no caveat about the decision log right after the rule against a second state file"
[[ "$flat" == *'is not a state file. The state file says where the work stands; the log says why one run decided what it did. The log is not committed and is not read when work resumes.'* ]] \
    && ok "orchestrator.md: the log says why, is not committed and is not read on resume" \
    || bad "orchestrator.md: the caveat does not say what the log is for, that it is not committed or that it is not read on resume"

# common.md holds exactly Plain language, Evidence before "green" and Context hygiene.
heads="$(grep '^## ' "$RULES/common.md" 2>/dev/null | tr '\n' '|')"
[ "$heads" = '## Plain language|## Evidence before "green"|## Context hygiene|' ] \
    && ok "common.md sections: Plain language, Evidence, Context hygiene" || bad "common.md sections: $heads"
for p in 'Phase 0' 'Quota' 'Default loop' 'Phase 2' 'Phase 3' 'Delegate by default' 'Subagent contract'; do
    if grep -qF "$p" "$RULES/common.md" 2>/dev/null; then bad "common.md carries the orchestrator topic $p"; else ok "common.md has no $p"; fi
done

# --- 6. Machine-read strings and Cyrillic --------------------------------------------------------

# The status block lines as worfy parses them: LINE in src/shared/agent/status-block.ts.
# The dashes are an alternation, not a bracket: in the C locale (Git Bash without LANG) grep reads a
# bracket byte by byte and a multibyte dash never matches.
for label in Этап Сейчас Дальше Жду; do
    grep -qE "^[[:space:]]*(—|–|-)[[:space:]]*$label[[:space:]]*:" "$RULES/orchestrator.md" 2>/dev/null \
        && ok "orchestrator.md: status line '— $label:'" || bad "orchestrator.md: no status line '— $label:'"
done
for p in '[gate] зелено (…)' 'ничего не прогналось' 'ПРОВЕРИТЬ НЕ УДАЛОСЬ'; do
    grep -qF -- "$p" "$all" && ok "gate verdict words kept: $p" || bad "gate verdict words missing: $p"
done

# Cyrillic only in the status labels and the gate verdict words. Rules for writing in one language
# live in the user's own rules file, not in the plugin.
ALLOWED='["Этап","Сейчас","Дальше","Жду","[gate] зелено","ничего не прогналось","ПРОВЕРИТЬ НЕ УДАЛОСЬ"]'
for p in 'Writing in Russian' 'stays in Latin' '## Terms'; do
    if grep -qF -- "$p" "$all"; then bad "parts carry the language rule '$p'"; else ok "parts carry no language rule '$p'"; fi
done
for f in ${parts[@]+"${parts[@]}"}; do
    left="$(node -e '
let s = require("fs").readFileSync(0, "utf8")
for (const a of JSON.parse(process.argv[1])) s = s.split(a).join("")
process.stdout.write([...new Set(s.match(/[Ѐ-ӿ]+/g) || [])].sort().join(" "))' "$ALLOWED" <"$f")"
    [ -z "$left" ] && ok "$(basename "$f"): Cyrillic only in allowed strings" || bad "$(basename "$f"): Cyrillic outside allowed strings: $left"
done

for p in Telegram 'Standing authorization'; do
    # Not -iF: grep of Git Bash on Windows aborts on -i with -F (exit 134), and the check passed
    # without looking. The two names have no regex characters.
    grep -qi -- "$p" "$all"; found=$?
    case "$found" in
        0) bad "parts mention $p" ;;
        1) ok "parts do not mention $p" ;;
        *) bad "grep failed (exit $found) looking for $p" ;;
    esac
done
if grep -qwE '(me|my|I)' "$all"; then
    bad "parts speak as the user (me/my/I): $(grep -nwE '(me|my|I)' "$all" | head -n 3 | tr '\n' ' ')"
else
    ok "parts say 'the user', not me/my/I"
fi

# --- 7. hooks.json ------------------------------------------------------------------------------

HJ="$HOOKS/hooks.json"
# hj <what>: lines read from hooks.json. "valid" prints ok when it is JSON with an object .hooks;
# "hooks" prints event|matcher|command|timeout per hook; "types" the hook types, unique, joined by
# commas; "commands" the commands, unique.
hj() {
    node -e '
const [file, what] = process.argv.slice(1)
let h
try { h = JSON.parse(require("fs").readFileSync(file, "utf8")).hooks } catch { process.exit(1) }
if (!h || typeof h !== "object") process.exit(1)
const all = []
for (const [e, groups] of Object.entries(h)) for (const g of groups) for (const k of g.hooks) all.push([e, g.matcher ?? "", k])
const uniq = (a) => [...new Set(a)].sort()
const out = {
    valid: () => ["ok"],
    hooks: () => all.map(([e, m, k]) => `${e}|${m}|${k.command}|${k.timeout}`),
    types: () => [uniq(all.map(([, , k]) => k.type)).join(",")],
    commands: () => uniq(all.map(([, , k]) => k.command)),
    inject: () => all.filter(([, , k]) => k.command.includes("inject-rules.mjs")).map(([e, , k]) => `${e}|${k.command}`),
}[what]()
for (const l of out) process.stdout.write(l + "\n")' "$HJ" "$1" 2>/dev/null
}
if [ "$(hj valid)" = ok ]; then ok "hooks.json is valid JSON with .hooks"; else bad "hooks.json missing or invalid"; fi

# The hooks of ~/.claude/settings.json:5-109, plus the three inject-rules entries; qmd-refresh came
# with the qmd server of the plugin (worfy-harness ticket 17). No WorktreeCreate: hooks/worktree-create.sh stays unregistered until
# worfy-harness ticket 24 (owner decision 2026-10-09). Every Node script runs as an explicit
# `node "${CLAUDE_PLUGIN_ROOT}/…"` (ADR-0055 item 2, worfy-windows ticket 04): Windows starts no
# script by its #! line. Two exceptions: the gate hooks call the launcher gate.sh, because without
# node only the launcher can say so (worfy-windows ticket 03); qmd-refresh is a zsh script until
# worfy-windows ticket 15.
# One line per hook: event|matcher|command|timeout.
R='"${CLAUDE_PLUGIN_ROOT}'
N='node "${CLAUDE_PLUGIN_ROOT}'
# Read outside $(…): macOS bash 3.2 cannot parse a here-document with an odd number of quotes
# inside a command substitution.
IFS= read -r -d '' hooks_expected <<EOF
SessionStart||$N/hooks/session-start.mjs"|15
SessionStart||$N/bin/worktree-lock" claim|10
SessionStart||$N/hooks/inject-rules.mjs" orchestrator|10
SessionStart||$N/hooks/inject-rules.mjs" common|10
SessionStart||$N/hooks/gh-token-env.mjs"|10
SubagentStart||$N/hooks/inject-rules.mjs" common|10
TaskCompleted||$R/hooks/gate.sh" fast|900
TeammateIdle||$R/hooks/gate.sh" fast|900
Stop||$N/hooks/stop.mjs"|10
Stop||$N/bin/worktree-lock" beat|5
Stop||$R/bin/qmd-refresh" --quiet|15
SessionEnd||$N/hooks/session-end.mjs"|10
SessionEnd||$N/bin/worktree-lock" release|5
PreToolUse|Bash|$N/hooks/guard.mjs"|10
EOF
expected="$(printf '%s' "$hooks_expected" | sort)"
actual="$(hj hooks | sort)"
if [ "$actual" = "$expected" ]; then
    ok "hooks.json: events, matchers, commands and timeouts as expected"
else
    bad "hooks.json differs: $(diff <(echo "$expected") <(echo "$actual") | grep '^[<>]' | tr '\n' ' ')"
fi
types="$(hj types)"
[ "$types" = command ] && ok "hooks.json: every hook is a command" || bad "hooks.json: hook types '$types'"
# A command that names a Node script (a .mjs file, or bin/worktree-lock, which has no extension)
# starts with `node `: Windows does not start a script by its #! line.
while IFS= read -r cmd; do
    case "$cmd" in
        *.mjs\"* | */bin/worktree-lock\"*)
            case "$cmd" in
                'node "${CLAUDE_PLUGIN_ROOT}/'*) ok "runs through node: $cmd" ;;
                *) bad "a Node script without node: $cmd" ;;
            esac ;;
    esac
done < <(hj commands)
if grep -q 'bin/qmd-refresh.* --quiet' "$HJ" 2>/dev/null; then ok "hooks.json: Stop runs qmd-refresh --quiet"; else bad "hooks.json: no qmd-refresh"; fi

# Every command path, with ${CLAUDE_PLUGIN_ROOT} = harness, exists and is executable. A command
# that starts with `node ` (ADR-0055) names a file node reads: it must exist, with or without the
# executable bit.
while IFS= read -r cmd; do
    path="$(printf '%s' "$cmd" | sed -n 's#^\(node \)\{0,1\}"\${CLAUDE_PLUGIN_ROOT}\(/[^"]*\)".*#\2#p')"
    if [ -z "$path" ]; then bad "command not of the form [node ]\"\${CLAUDE_PLUGIN_ROOT}/…\": $cmd"; continue; fi
    if [ "${cmd#node }" != "$cmd" ]; then
        [ -f "$HARNESS$path" ] && ok "run by node, exists: $path" || bad "missing: $path"
    else
        [ -x "$HARNESS$path" ] && ok "executable: $path" || bad "not executable or missing: $path"
    fi
done < <(hj commands)

# The inject-rules commands of hooks.json, run the way Claude Code runs them, print their part.
# On Windows Claude Code gives ${CLAUDE_PLUGIN_ROOT} as C:/…; elsewhere it is the plain path.
n=0
while IFS='|' read -r ev cmd; do
    n=$((n + 1))
    printf '{"hook_event_name":"%s"}' "$ev" | CLAUDE_PLUGIN_ROOT="$HARNESS_N" sh -c "$cmd" >"$T/out" 2>/dev/null
    part="${cmd##* }"
    first="$(ctx | head -n 1)"
    [ "$first" = "# worfy Harness — $part rules" ] && ok "hooks.json $ev runs $part" || bad "hooks.json $ev '$cmd': got '$first'"
done < <(hj inject)
[ "$n" -eq 3 ] && ok "hooks.json: three inject-rules.mjs commands run" || bad "hooks.json: $n inject-rules.mjs commands, not 3"

# --- 8. The old rules file is gone --------------------------------------------------------------

[ ! -e "$HARNESS/rules/global.md" ] && ok "rules/global.md removed" || bad "rules/global.md still there"
[ ! -e "$HARNESS/rules" ] && ok "rules/ removed" || bad "rules/ still there"

echo "--- passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
